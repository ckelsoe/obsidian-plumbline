import type { Diagnostic } from './types';
import { normalize } from './verbatim';

// Quotes checked against source notes (references step 3). A quote names its
// source with a wikilink to a note in a source folder, written straight after
// it, or in a footnote whose text opens with that wikilink:
//
//   "we shipped late" ([[2024-03-02 Interview]])
//   "we shipped late"[^1]      ...      [^1]: [[2024-03-02 Interview]]
//   > We shipped late.
//   > ([[2024-03-02 Interview]])
//
// The quoted words must appear in the linked note. A link to a note outside
// every source folder the group uses is not a citation this check knows about,
// so it is skipped quietly. Pure: the plugin reads the source notes and hands
// them in as an index.

export const SOURCE_QUOTE_SLUG = 'quote-not-in-source';
export const SOURCE_QUOTE_PACK_ID = 'quote-source';

// One note in a source folder, with its text already prepared by
// prepareSourceText, so each lint pass only searches.
export interface SourceNote {
	// The reference (source folder) it came from, by its display name.
	reference: string;
	// Vault path without the ".md" extension, lower-cased, for path links.
	pathKey: string;
	// The note's name as a link would show it.
	title: string;
	text: string;
}

// Source notes by lower-cased note name. Two source folders may hold notes with
// the same name, so each name maps to every such note.
export type SourceNoteIndex = ReadonlyMap<string, readonly SourceNote[]>;

// A quote and the note it cites, found in prose.
export interface LinkedQuote {
	start: number;
	end: number;
	quote: string;
	link: string;
}

// Double and single quotation marks, straight and curly. The two kinds nest
// inside each other ("he said 'no' today"), so each is tracked on its own.
const DOUBLE_MARKS = new Set(['"', '“', '”']);
const SINGLE_MARKS = new Set(["'", '‘', '’']);
const OPENING_CURLY = new Set(['“', '‘']);
const CLOSING_CURLY = new Set(['”', '’']);
const CLOSING = new Set(['"', '”', "'", '’']);

// Replace each one-line wikilink with the text it shows: "[[Note|shown]]" reads
// "shown", "[[Note]]" reads "Note". Scanned by index, so nothing backtracks.
function unlinked(text: string): string {
	let out = '';
	let cursor = 0;
	for (
		let at = text.indexOf('[[', 0);
		at !== -1;
		at = text.indexOf('[[', at)
	) {
		const close = text.indexOf(']]', at + 2);
		const newline = text.indexOf('\n', at);
		if (close === -1 || (newline !== -1 && newline < close)) {
			at += 2;
			continue;
		}
		const inner = text.slice(at + 2, close);
		const bar = inner.indexOf('|');
		out +=
			text.slice(cursor, at) +
			(bar === -1 ? inner : inner.slice(bar + 1));
		cursor = close + 2;
		at = cursor;
	}
	return out + text.slice(cursor);
}

// Split a quote at its gaps: an ellipsis ("..." or "…") or a bracketed
// editorial insertion ("[the team]") on one line.
function quoteFragments(quote: string): string[] {
	const fragments: string[] = [];
	let current = '';
	for (let i = 0; i < quote.length; i++) {
		const char = quote[i] ?? '';
		if (quote.startsWith('...', i) || char === '…') {
			fragments.push(current);
			current = '';
			i += char === '…' ? 0 : 2;
			continue;
		}
		if (char === '[') {
			const close = quote.indexOf(']', i + 1);
			const newline = quote.indexOf('\n', i + 1);
			if (close !== -1 && (newline === -1 || close < newline)) {
				fragments.push(current);
				current = '';
				i = close;
				continue;
			}
		}
		current += char;
	}
	fragments.push(current);
	return fragments;
}

// The ")" that closes a link destination opened at `open`, stepping over
// balanced "(...)" and backslash-escaped parentheses inside it, as Markdown
// does. -1 when it is not closed on the same line.
function destinationEnd(text: string, open: number): number {
	let depth = 0;
	for (let i = open + 1; i < text.length; i++) {
		const char = text[i];
		if (char === '\n') {
			return -1;
		}
		if (char === '\\') {
			i++;
		} else if (char === '(') {
			depth++;
		} else if (char === ')') {
			if (depth === 0) {
				return i;
			}
			depth--;
		}
	}
	return -1;
}

// Replace each one-line Markdown link with its text: "[shown](url)" reads
// "shown". Scanned by index, so nothing backtracks.
function unlinkedMarkdown(text: string): string {
	let out = '';
	let cursor = 0;
	for (let at = text.indexOf('[', 0); at !== -1; at = text.indexOf('[', at)) {
		const close = text.indexOf(']', at + 1);
		const newline = text.indexOf('\n', at);
		const onLine = (n: number): boolean =>
			n !== -1 && (newline === -1 || n < newline);
		const paren = close + 1;
		const end = text[paren] === '(' ? destinationEnd(text, paren) : -1;
		if (!onLine(close) || !onLine(end)) {
			at += 1;
			continue;
		}
		out += text.slice(cursor, at) + text.slice(at + 1, close);
		cursor = end + 1;
		at = cursor;
	}
	return out + text.slice(cursor);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && WORD_CHAR.test(char);
}

// Drop an underscore that marks emphasis ("_very_"), keeping one inside a word
// ("snake_case").
function withoutEmphasisUnderscores(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? '';
		if (
			char === '_' &&
			(!isWordChar(text[i - 1]) || !isWordChar(text[i + 1]))
		) {
			continue;
		}
		out += char;
	}
	return out;
}

// The Markdown formatting a writer or a source note may carry that a reader
// never sees: links (keeping the text they show) and emphasis markers.
function withoutFormatting(text: string): string {
	return withoutEmphasisUnderscores(
		unlinkedMarkdown(unlinked(text)).replace(/\*\*|==|~~|\*/g, ''),
	);
}

// Prepare a source note for searching: drop its frontmatter, block IDs, and
// formatting, then normalize it like a quote.
export function prepareSourceText(content: string): string {
	let body = content;
	if (/^---[ \t]*\r?\n/.test(body)) {
		const end = body.indexOf('\n---', 3);
		if (end !== -1) {
			const lineEnd = body.indexOf('\n', end + 4);
			body = lineEnd === -1 ? '' : body.slice(lineEnd + 1);
		}
	}
	// Blockquote marks start lines a quote of the passage would run across.
	body = body
		.split('\n')
		.map((line) => (/^[ \t]*>/.test(line) ? blockquoteContent(line) : line))
		.join('\n')
		.replace(/(^|\s)\^[A-Za-z0-9-]+(?=\s|$)/g, '$1');
	return normalize(withoutFormatting(body));
}

// Trim quote marks and the punctuation a writer moves in or out of a quote
// ("late," for "late.") from both ends of a fragment.
function trimFragment(text: string): string {
	const edge = new Set([
		'"',
		"'",
		'“',
		'”',
		'‘',
		'’',
		'.',
		',',
		';',
		':',
		'!',
		'?',
		' ',
	]);
	let start = 0;
	let end = text.length;
	while (start < end && edge.has(text[start] ?? '')) {
		start++;
	}
	while (end > start && edge.has(text[end - 1] ?? '')) {
		end--;
	}
	return text.slice(start, end);
}

// The first place at or after `from` where the fragment sits on word edges, so
// "we ship" is not found inside "we shipped". A fragment edge that is not a
// letter or digit needs no edge.
function wordAlignedIndex(
	source: string,
	fragment: string,
	from: number,
): number {
	const needStart = isWordChar(fragment[0]);
	const needEnd = isWordChar(fragment[fragment.length - 1]);
	for (
		let at = source.indexOf(fragment, from);
		at !== -1;
		at = source.indexOf(fragment, at + 1)
	) {
		const startOk = !needStart || !isWordChar(source[at - 1]);
		const endOk = !needEnd || !isWordChar(source[at + fragment.length]);
		if (startOk && endOk) {
			return at;
		}
	}
	return -1;
}

// The runs of quoted words to look for, once formatting and gaps are gone.
function searchableFragments(quote: string): string[] {
	return quoteFragments(normalize(withoutFormatting(quote)))
		.map(trimFragment)
		.filter((fragment) => fragment.length > 0);
}

// Whether a quote holds any words to check. One made only of gaps or an
// insertion ("[inaudible]") is not a claim about the source's wording, so it
// is neither passed nor flagged.
export function hasQuotedWords(quote: string): boolean {
	return searchableFragments(quote).length > 0;
}

// Does the quote appear in the prepared source text? An ellipsis or a bracketed
// editorial insertion ("[the team]") marks a gap: every fragment either side of
// it must appear, in order.
// A quote with no words of its own ("[inaudible]", "...") has nothing to
// find, so it never counts as found.
export function quoteInSource(quote: string, source: string): boolean {
	const fragments = searchableFragments(quote);
	if (fragments.length === 0) {
		return false;
	}
	let from = 0;
	for (const fragment of fragments) {
		const at = wordAlignedIndex(source, fragment, from);
		if (at === -1) {
			return false;
		}
		from = at + fragment.length;
	}
	return true;
}

// The note a wikilink names: the part before any "#heading" or "|alias".
function linkTarget(inner: string): string {
	let end = inner.length;
	for (const stop of ['#', '|']) {
		const at = inner.indexOf(stop);
		if (at !== -1 && at < end) {
			end = at;
		}
	}
	return inner.slice(0, end).trim();
}

interface Link {
	start: number;
	end: number;
	target: string;
}

// The wikilink starting at `at` ("[[...]]" on one line), or null. An embed
// ("![[...]]") shows a note rather than citing it, so it is not a link here.
function wikilinkAt(text: string, at: number): Link | null {
	if (!text.startsWith('[[', at) || text[at - 1] === '!') {
		return null;
	}
	const close = text.indexOf(']]', at + 2);
	const newline = text.indexOf('\n', at);
	if (close === -1 || (newline !== -1 && newline < close)) {
		return null;
	}
	const target = linkTarget(text.slice(at + 2, close));
	return target.length > 0 ? { start: at, end: close + 2, target } : null;
}

// Footnote definitions whose text opens with a wikilink, by footnote label.
function footnoteSources(text: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /^[ \t]*\[\^([^\]\s]+)\]:[ \t]*/gm;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		const link = wikilinkAt(text, re.lastIndex);
		if (link && m[1] !== undefined && !out.has(m[1])) {
			out.set(m[1], link.target);
		}
	}
	return out;
}

interface Citation {
	target: string;
	// Offset just past the citation.
	end: number;
}

// The citation that starts at `at`, after optional spaces and an optional dash:
// "([[Note]])", "[[Note]]", or a footnote reference whose definition cites a
// note.
function citationAt(
	text: string,
	at: number,
	footnotes: ReadonlyMap<string, string>,
): Citation | null {
	let i = at;
	while (' \t-—–'.includes(text[i] ?? 'x')) {
		i++;
	}
	if (text.startsWith('[^', i)) {
		const close = text.indexOf(']', i + 2);
		const target =
			close === -1 ? undefined : footnotes.get(text.slice(i + 2, close));
		return target === undefined ? null : { target, end: close + 1 };
	}
	const paren = text[i] === '(';
	const link = wikilinkAt(text, paren ? i + 1 : i);
	if (!link || (paren && text[link.end] !== ')')) {
		return null;
	}
	return { target: link.target, end: paren ? link.end + 1 : link.end };
}

// Does a blank line (spaces, tabs and a CR allowed) follow the newline at `at`?
function blankLineAfter(text: string, at: number): boolean {
	let i = at + 1;
	while (text[i] === ' ' || text[i] === '\t' || text[i] === '\r') {
		i++;
	}
	return i >= text.length || text[i] === '\n';
}

// Whether a quote mark opens or closes a quotation. Curly marks say so; a
// straight mark is read from its neighbours: after a space or opening
// punctuation and before a word it opens, after a word and before a space or
// punctuation it closes. Anything else is decided by whether a quotation is
// open.
function opensQuote(text: string, at: number, open: boolean): boolean {
	const char = text[at] ?? '';
	if (OPENING_CURLY.has(char)) {
		return true;
	}
	if (CLOSING_CURLY.has(char)) {
		return false;
	}
	const before = text[at - 1];
	const after = text[at + 1];
	const spaceBefore = before === undefined || /[\s([{—–-]/.test(before);
	const spaceAfter = after === undefined || /[\s.,;:!?)\]]/.test(after);
	if (spaceBefore && !spaceAfter) {
		return true;
	}
	if (!spaceBefore && spaceAfter) {
		return false;
	}
	return !open;
}

// Is the next single quotation mark after `from`, in this paragraph, a close
// followed by a citation? Apostrophes inside words ("didn't") are passed over.
// Only then is a single close before it read as a possessive: a mark that
// opens another quotation first ("'hello' and then 'goodbye' [[Source]]")
// means the earlier close really closed.
function citedSingleCloseAhead(
	text: string,
	from: number,
	footnotes: ReadonlyMap<string, string>,
): boolean {
	for (let i = from; i < text.length; i++) {
		const char = text[i] ?? '';
		if (char === '\n' && blankLineAfter(text, i)) {
			return false;
		}
		if (!SINGLE_MARKS.has(char)) {
			continue;
		}
		if (isWordChar(text[i - 1]) && isWordChar(text[i + 1])) {
			continue;
		}
		return (
			char !== '‘' &&
			!isWordChar(text[i + 1]) &&
			citationAt(text, i + 1, footnotes) !== null
		);
	}
	return false;
}

// Inline quotes: a quoted run inside one paragraph, cited straight after its
// closing mark. Quotations nest ("we called it "late" today"), so open marks
// are kept on a stack and a cited close pairs with the mark that opened it.
// Scanned by index, so no pattern can backtrack.
function inlineQuotes(
	text: string,
	footnotes: ReadonlyMap<string, string>,
): LinkedQuote[] {
	const out: LinkedQuote[] = [];
	const stacks = { double: [] as number[], single: [] as number[] };
	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? '';
		if (char === '\n' && blankLineAfter(text, i)) {
			stacks.double.length = 0;
			stacks.single.length = 0;
			continue;
		}
		const single = SINGLE_MARKS.has(char);
		if (!single && !DOUBLE_MARKS.has(char)) {
			continue;
		}
		// A single mark between two letters is an apostrophe ("didn't").
		if (single && isWordChar(text[i - 1]) && isWordChar(text[i + 1])) {
			continue;
		}
		const stack = single ? stacks.single : stacks.double;
		if (opensQuote(text, i, stack.length > 0)) {
			// Single quotes nest inside double ones, never inside each other,
			// so a single "opener" inside an open single quote is an elision
			// apostrophe ('em, 'til).
			if (!single || stack.length === 0) {
				stack.push(i);
			}
			continue;
		}
		const citation = citationAt(text, i + 1, footnotes);
		// A possessive ("the workers' concerns") looks like a closing single
		// mark. When a later single mark in the paragraph closes with a
		// citation, this one is read as an apostrophe instead.
		if (
			single &&
			citation === null &&
			stack.length > 0 &&
			citedSingleCloseAhead(text, i + 1, footnotes)
		) {
			continue;
		}
		const open = stack.pop();
		if (open === undefined) {
			continue;
		}
		// A quote that wraps inside a blockquote carries the next line's marks.
		const quote = text.slice(open + 1, i).replace(/\n[ \t>]*/g, ' ');
		if (citation !== null && quote.trim().length > 0) {
			out.push({ start: open, end: i + 1, quote, link: citation.target });
		}
	}
	return out;
}

// Strip the blockquote marks from a line.
function blockquoteContent(line: string): string {
	let i = 0;
	while (i < line.length && (line[i] === '>' || line[i] === ' ')) {
		i++;
	}
	return line.slice(i);
}

// A citation that ends a blockquote line: "([[Note]])", "[[Note]]", either after
// a dash or hyphens ("-- [[Note]]"), or a footnote reference, followed by at
// most one closing punctuation mark. Returns where the citation (with its dash)
// starts in the line.
function trailingCitation(
	line: string,
	footnotes: ReadonlyMap<string, string>,
): { at: number; link: string } | null {
	const trimmed = line.trimEnd();
	const candidates = [
		trimmed.lastIndexOf('([['),
		trimmed.lastIndexOf('[['),
		trimmed.lastIndexOf('[^'),
	].filter((n) => n !== -1);
	for (const at of candidates) {
		const citation = citationAt(trimmed, at, footnotes);
		if (
			citation === null ||
			!/^[.,;]?$/.test(trimmed.slice(citation.end))
		) {
			continue;
		}
		let start = at;
		while (start > 0 && ' \t-—–'.includes(line[start - 1] ?? 'x')) {
			start--;
		}
		return { at: start, link: citation.target };
	}
	return null;
}

// Blockquotes whose last line carries a citation. A quote in quotation marks
// before that citation is left to the inline pass, so it is not checked twice.
function blockQuotes(
	text: string,
	footnotes: ReadonlyMap<string, string>,
): LinkedQuote[] {
	const out: LinkedQuote[] = [];
	let offset = 0;
	let blockStart = -1;
	let blockLines: string[] = [];
	const lines = [...text.split('\n'), ''];
	for (const line of lines) {
		if (/^[ \t]*>/.test(line)) {
			if (blockStart === -1) {
				blockStart = offset;
			}
			blockLines.push(line);
		} else if (blockStart !== -1) {
			const found = citedBlock(blockStart, blockLines, footnotes);
			if (found) {
				out.push(found);
			}
			blockStart = -1;
			blockLines = [];
		}
		offset += line.length + 1;
	}
	return out;
}

function citedBlock(
	start: number,
	lines: readonly string[],
	footnotes: ReadonlyMap<string, string>,
): LinkedQuote | null {
	const last = lines[lines.length - 1] ?? '';
	const citation = trailingCitation(last, footnotes);
	if (!citation) {
		return null;
	}
	const before = last.slice(0, citation.at).trimEnd();
	if (CLOSING.has(before[before.length - 1] ?? '')) {
		return null;
	}
	const kept = [...lines.slice(0, -1), before];
	// Offsets of the quoted words: from the first content character to the end
	// of the last one, so the underline sits on the quote, not the marks.
	let quoteStart = -1;
	let quoteEnd = -1;
	const parts: string[] = [];
	let offset = start;
	kept.forEach((line, index) => {
		// A callout's first line is its type and title, not quoted words.
		const isCallout = index === 0 && /^[ \t>]*\[!/.test(line);
		const content = isCallout ? '' : blockquoteContent(line);
		const contentStart = offset + line.length - content.length;
		if (content.trim().length > 0) {
			if (quoteStart === -1) {
				quoteStart = contentStart;
			}
			quoteEnd = contentStart + content.trimEnd().length;
			parts.push(content);
		}
		offset += (lines[index] ?? '').length + 1;
	});
	if (quoteStart === -1) {
		return null;
	}
	return {
		start: quoteStart,
		end: quoteEnd,
		quote: parts.join(' '),
		link: citation.link,
	};
}

// Every quote in the text that cites a note, in document order.
export function findLinkedQuotes(text: string): LinkedQuote[] {
	const footnotes = footnoteSources(text);
	return [
		...inlineQuotes(text, footnotes),
		...blockQuotes(text, footnotes),
	].sort((a, b) => a.start - b.start);
}

// Resolve a relative link ("./x", "../Sources/x") against the folder of the
// note it is written in, giving a vault path, or null when it climbs above
// the vault root.
function resolveRelative(link: string, notePath: string): string | null {
	const parts = notePath.split('/').slice(0, -1);
	for (const step of link.split('/')) {
		if (step === '..') {
			if (parts.length === 0) {
				return null;
			}
			parts.pop();
		} else if (step !== '.' && step !== '') {
			parts.push(step);
		}
	}
	return parts.join('/');
}

// The source notes a link could mean. A plain name matches any note of that
// name; a link with a folder path must match the end of the note's path. A
// relative link is resolved from the citing note's folder and must match one
// note exactly; without the citing note's path it cannot be, so it is skipped.
function notesFor(
	index: SourceNoteIndex,
	link: string,
	notePath: string | undefined,
): readonly SourceNote[] {
	let key = link.toLowerCase().replace(/\.md$/, '');
	const relative = key.startsWith('./') || key.startsWith('../');
	if (relative) {
		const resolved =
			notePath === undefined
				? null
				: resolveRelative(key, notePath.toLowerCase());
		if (resolved === null) {
			return [];
		}
		key = resolved;
	}
	const slash = key.lastIndexOf('/');
	const candidates = index.get(slash === -1 ? key : key.slice(slash + 1));
	// A resolved relative link is a full vault path even without a slash
	// ("../Interview" from "Drafts/A.md" is "Interview", at the vault root), so
	// it always takes the exact-path check below.
	if (!candidates || (slash === -1 && !relative)) {
		return candidates ?? [];
	}
	return candidates.filter((note) =>
		relative
			? note.pathKey === key
			: note.pathKey === key || note.pathKey.endsWith(`/${key}`),
	);
}

function quoteMessage(notes: readonly SourceNote[]): string {
	if (notes.length === 1) {
		const note = notes[0];
		return `${note?.reference ?? ''}: this quote is not in [[${note?.title ?? ''}]].`;
	}
	const each = notes.map((n) => `[[${n.title}]] (${n.reference})`);
	return `This quote is not in ${each.join(' or ')}.`;
}

// Check every cited quote against the notes it names. A quote found in any note
// the link could mean passes; otherwise the finding names every note searched,
// each with its reference, so nothing is decided silently.
export function checkSourceQuotes(
	text: string,
	index: SourceNoteIndex,
	notePath?: string,
): Diagnostic[] {
	if (index.size === 0) {
		return [];
	}
	const out: Diagnostic[] = [];
	for (const quote of findLinkedQuotes(text)) {
		const notes = notesFor(index, quote.link, notePath);
		if (notes.length === 0 || !hasQuotedWords(quote.quote)) {
			continue;
		}
		if (notes.some((note) => quoteInSource(quote.quote, note.text))) {
			continue;
		}
		out.push({
			ruleSlug: SOURCE_QUOTE_SLUG,
			packId: SOURCE_QUOTE_PACK_ID,
			severity: 'warning',
			start: quote.start,
			end: quote.end,
			message: quoteMessage(notes),
			findingMessage:
				'Quotes not found in the source notes they cite. Hover each one for its source.',
		});
	}
	return out;
}

// Build the index for a group from its source folders' notes.
export function buildSourceNoteIndex(
	folders: readonly {
		reference: string;
		notes: readonly { path: string; title: string; text: string }[];
	}[],
): SourceNoteIndex {
	const index = new Map<string, SourceNote[]>();
	for (const folder of folders) {
		for (const note of folder.notes) {
			const key = note.title.toLowerCase();
			const list = index.get(key) ?? [];
			list.push({
				reference: folder.reference,
				pathKey: note.path.toLowerCase().replace(/\.md$/, ''),
				title: note.title,
				text: note.text,
			});
			index.set(key, list);
		}
	}
	return index;
}
