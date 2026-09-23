import { FixOption, Rule } from './types';

// Term lists: a voice or style file that names terms to avoid and, where there
// is one, the term to use instead. The format is plain Markdown, the same tables
// the brand-voice skill's brand.md and phrases.md use, so an existing brand file
// works as-is. See the README, "Brand voice and style: term lists".
//
// Two shapes are read, anywhere in the file:
//
// - A table with a column to avoid ("Do not use", "Avoid", "Jargon", "Banned")
//   and, optionally, a column to use ("Use instead", "Plain replacement",
//   "Product name", "Preferred"). Columns are found by their header, not their
//   position, because brand.md puts the right name first and phrases.md puts
//   the phrase to avoid first. A cell may list several terms, split by commas.
// - A bullet that opens with a quote, such as - "Here's the thing:". Every
//   quoted phrase on the line is flagged, with no replacement. A bullet that
//   does not open with a quote is guidance prose, not a term, and is ignored. A placeholder like [X] ends
//   the phrase: "Here's what [X]" flags "Here's what".

export interface TermEntry {
	term: string;
	// The term to use instead, when the list names one.
	replacement?: string;
	// True when the term differs from its replacement only by case, such as a
	// product name spelled "PlumbLine" for "Plumbline". Matching then keeps case,
	// or the correct spelling would be flagged too.
	caseSensitive: boolean;
}

const AVOID_HEADERS = [
	'do not',
	"don't",
	'dont',
	'avoid',
	'banned',
	'jargon',
	'never',
	'instead of',
	'wrong',
];
const USE_HEADERS = [
	'use',
	'replace',
	'prefer',
	'correct',
	'product',
	'say',
	'write',
	'right',
];

function cleanHeader(cell: string): string {
	return cell.replace(/[*_`]/g, '').trim().toLowerCase();
}

function isAvoidHeader(cell: string): boolean {
	const header = cleanHeader(cell);
	return AVOID_HEADERS.some((word) => header.includes(word));
}

function isUseHeader(cell: string): boolean {
	const header = cleanHeader(cell);
	return USE_HEADERS.some((word) => header.includes(word));
}

function splitRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith('|')) {
		row = row.slice(1);
	}
	if (row.endsWith('|')) {
		row = row.slice(0, -1);
	}
	return row.split('|').map((cell) => cell.trim());
}

function isDividerRow(cells: string[]): boolean {
	return (
		cells.length > 0 &&
		cells.every((cell) => cell.length > 0 && /^:?-+:?$/.test(cell))
	);
}

// The one spelling a placeholder is stored in, whatever the list wrote ([X],
// [thing], [noun]).
export const PLACEHOLDER = '[X]';

function normalizePlaceholders(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const open = text.indexOf('[', i);
		const close = open === -1 ? -1 : text.indexOf(']', open + 1);
		if (open === -1 || close === -1) {
			out += text.slice(i);
			break;
		}
		out += text.slice(i, open) + PLACEHOLDER;
		i = close + 1;
	}
	return out;
}

const QUOTE_EDGES = new Set(['"', "'", '`', '“', '”', '‘', '’']);
const QUOTE_OPENERS = new Set(['"', '“', '`']);

// Strip emphasis and wrapping quotes from a cell value, and cut it at a [X]
// placeholder.
function cleanTerm(raw: string): string {
	let term = raw.replace(/\*\*|__/g, '').trim();
	// A trailing placeholder just ends the phrase ("Here's what [X]" flags
	// "Here's what"). One in the middle stays, as [X], and matches any single
	// word, so "The real [X] is" flags "The real problem is" but not every
	// "the real".
	term = normalizePlaceholders(term);
	while (term.endsWith(PLACEHOLDER)) {
		term = term.slice(0, -PLACEHOLDER.length).trim();
	}
	let start = 0;
	let end = term.length;
	while (start < end && QUOTE_EDGES.has(term.charAt(start))) {
		start++;
	}
	while (end > start && QUOTE_EDGES.has(term.charAt(end - 1))) {
		end--;
	}
	return term.slice(start, end).trim();
}

// The quoted phrases on a bullet line, in order. Straight, curly, and backtick
// quotes all count.
function quotedPhrases(text: string): string[] {
	const phrases: string[] = [];
	const pairs: [string, string][] = [
		['"', '"'],
		['“', '”'],
		['`', '`'],
	];
	for (const [open, close] of pairs) {
		let from = 0;
		for (;;) {
			const a = text.indexOf(open, from);
			if (a === -1) {
				break;
			}
			const b = text.indexOf(close, a + 1);
			if (b === -1) {
				break;
			}
			phrases.push(text.slice(a + 1, b));
			from = b + 1;
		}
	}
	return phrases;
}

function entry(term: string, replacement?: string): TermEntry | null {
	if (term.length < 2) {
		return null;
	}
	const use = replacement && replacement.length > 0 ? replacement : undefined;
	// A row whose term and replacement are identical would flag the right word.
	if (use === term) {
		return null;
	}
	return {
		term,
		...(use === undefined ? {} : { replacement: use }),
		caseSensitive:
			use !== undefined &&
			use !== term &&
			use.toLowerCase() === term.toLowerCase(),
	};
}

// Read every term from a term-list file. Frontmatter, headings, prose, and
// empty template rows are ignored. The same term listed twice keeps its first
// entry.
export function parseTermList(markdown: string): TermEntry[] {
	const lines = markdown.split(/\r?\n/);
	const entries: TermEntry[] = [];
	let table: { avoid: number; use: number } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();
		if (trimmed.startsWith('|')) {
			const cells = splitRow(trimmed);
			const next = splitRow(lines[i + 1] ?? '');
			if (table === null && isDividerRow(next)) {
				// A header row: decide which columns hold the terms.
				const avoid = cells.findIndex(isAvoidHeader);
				const use = cells.findIndex(
					(cell, index) => index !== avoid && isUseHeader(cell),
				);
				table = avoid === -1 ? { avoid: -1, use: -1 } : { avoid, use };
				i++; // skip the divider
				continue;
			}
			if (table !== null && table.avoid !== -1) {
				const replacement =
					table.use === -1
						? undefined
						: cleanTerm(cells[table.use] ?? '');
				for (const part of (cells[table.avoid] ?? '').split(/[,;]/)) {
					const made = entry(cleanTerm(part), replacement);
					if (made) {
						entries.push(made);
					}
				}
			}
			continue;
		}
		table = null;
		// Only a bullet that OPENS with a quote is a term. "- Use "we" for the
		// company." is guidance that happens to quote a word, not a ban on "we".
		const bullet = /^[-*+]\s/.test(trimmed) ? trimmed.slice(2).trim() : '';
		if (bullet.length > 0 && QUOTE_OPENERS.has(bullet.charAt(0))) {
			for (const phrase of quotedPhrases(bullet)) {
				const made = entry(cleanTerm(phrase));
				if (made) {
					entries.push(made);
				}
			}
		}
	}
	const seen = new Set<string>();
	return entries.filter((e) => {
		const key = e.caseSensitive ? e.term : e.term.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

// A term typed with a straight apostrophe should still match prose typed with
// a curly one, and the other way round.
function apostropheVariants(term: string): string[] {
	const straight = term.replace(/[’‘]/g, "'");
	const curly = straight.replace(/'/g, '’');
	return straight === curly ? [straight] : [straight, curly];
}

function slugOf(term: string): string {
	let slug = '';
	for (const char of term.toLowerCase()) {
		const keep =
			(char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
		if (keep) {
			slug += char;
		} else if (slug.length > 0 && !slug.endsWith('-')) {
			slug += '-';
		}
	}
	return slug.endsWith('-') ? slug.slice(0, -1) : slug;
}

const TERM_PACK_ID = 'term-list';

// A short, stable hash of a term (FNV-1a, base 36), for slugs that must stay
// distinct and stable when two terms read the same once punctuation is dropped.
function hashOf(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).slice(0, 6);
}

export interface NamedTermList {
	name: string;
	entries: TermEntry[];
}

function quote(text: string): string {
	return `"${text}"`;
}

// The message a term finding carries. It always names the list(s) it came from,
// and when lists disagree it names each suggestion with its list, so the writer
// sees the conflict rather than a silent pick.
function termMessage(sources: string[], options: FixOption[]): string {
	if (options.length === 0) {
		return `${sources.join(', ')}: avoid this phrase.`;
	}
	const distinct = [...new Set(options.map((o) => o.text))];
	if (distinct.length === 1) {
		return `${sources.join(', ')}: use ${quote(distinct[0] ?? '')} instead.`;
	}
	const parts = options.map((o) => `${o.source} suggests ${quote(o.text)}`);
	return `The term lists disagree: ${parts.join('; ')}. Pick one.`;
}

// Build one rule per distinct term across a group's term lists. The same term
// in several lists becomes ONE rule (duplicates collapse) whose finding names
// every list and offers every suggestion, each labelled with its list.
export function buildTermRules(lists: readonly NamedTermList[]): Rule[] {
	interface Merged {
		term: string;
		caseSensitive: boolean;
		sources: string[];
		options: FixOption[];
	}
	const merged = new Map<string, Merged>();
	for (const list of lists) {
		for (const e of list.entries) {
			const key = e.caseSensitive ? `=${e.term}` : e.term.toLowerCase();
			const current = merged.get(key) ?? {
				term: e.term,
				caseSensitive: e.caseSensitive,
				sources: [],
				options: [],
			};
			if (!current.sources.includes(list.name)) {
				current.sources.push(list.name);
			}
			if (
				e.replacement !== undefined &&
				!current.options.some(
					(o) => o.text === e.replacement && o.source === list.name,
				)
			) {
				current.options.push({
					text: e.replacement,
					source: list.name,
				});
			}
			merged.set(key, current);
		}
	}
	const rules: Rule[] = [];
	const slugs = new Set<string>();
	for (const m of merged.values()) {
		// A slug must name the same term whatever else is in the lists, because a
		// note turns a term off by its slug. A plain term (words and spaces, any
		// case) gets a readable slug no other plain term can share; anything else
		// (punctuation, a hyphen, a case-sensitive spelling) adds a hash of the
		// exact term, so "foo bar" and "foo-bar" never trade slugs.
		const plain =
			!m.caseSensitive && /^[a-z0-9]+(?: [a-z0-9]+)*$/i.test(m.term);
		const readable = slugOf(m.term) || 'phrase';
		const base = plain
			? `term-${readable}`
			: `term-${readable}-${hashOf(m.term)}`;
		let slug = base;
		for (let n = 2; slugs.has(slug); n++) {
			slug = `${base}-${n}`;
		}
		slugs.add(slug);
		const phrases = apostropheVariants(m.term);
		const fixOptions: Record<string, FixOption[]> = {};
		if (m.options.length > 0) {
			for (const phrase of phrases) {
				fixOptions[m.caseSensitive ? phrase : phrase.toLowerCase()] =
					m.options;
			}
		}
		rules.push({
			slug,
			packId: TERM_PACK_ID,
			category: 'term',
			severity: 'warning',
			message: termMessage(m.sources, m.options),
			phrases,
			...(m.caseSensitive ? { caseSensitive: true } : {}),
			...(m.options.length > 0 ? { fixOptions } : {}),
		});
	}
	return rules;
}

// A one-line summary for the reference editor's setup check.
export function describeTermList(entries: readonly TermEntry[]): string {
	const withFix = entries.filter((e) => e.replacement !== undefined).length;
	const terms = `${entries.length} term${entries.length === 1 ? '' : 's'}`;
	return withFix === 0
		? `${terms}, none with a replacement.`
		: `${terms}, ${withFix} with a replacement.`;
}
