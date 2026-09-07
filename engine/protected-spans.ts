import { ResolvedConfig, Span } from './types';
import { scriptureSpans, SCRIPTURE_SPAN_KIND } from './scripture';

// The comment span kinds, split so a user can mask Annoteca's structural markers
// independently of their own plain HTML comments (they are disjoint: an Annoteca
// marker is never also counted as an other-HTML comment).
export const ANNOTECA_COMMENT_KIND = 'annoteca-comment';
export const HTML_COMMENT_KIND = 'html-comment';

// The base protected-span sources every profile starts with. Packs contribute
// more (scripture quotes, dialogue); a profile selects which are active.
// A region the note itself opted out of, between plumbline off/on directives
// (PL-D). Not in BASE_SPAN_KINDS: those are the kinds a profile can turn on and
// off, and a writer who wrote "skip this" in the note is not asking for a
// setting to be consulted.
export const SKIP_KIND = 'plumbline-skip';

export const BASE_SPAN_KINDS = [
	'frontmatter',
	'code',
	'heading',
	ANNOTECA_COMMENT_KIND,
	HTML_COMMENT_KIND,
] as const;

// Annoteca serializes every comment as `<!-- annoteca/<category>: ... -->`. Match
// that opener exactly (case-sensitive, like Annoteca's own grammar) so its markers
// can be masked apart from plain HTML comments.
const ANNOTECA_OPENER = /^<!--\s*annoteca\//;

// Leading YAML frontmatter: `---` on the first line through the next `---` line.
function frontmatterSpan(text: string): Span | null {
	if (!/^---[ \t]*\n/.test(text)) {
		return null;
	}
	// Append a newline so a document that ends right after the closing fence,
	// with no trailing newline, still matches. No lookbehind: `(?<=...)` is a
	// parse error in JavaScriptCore before iOS 16.4.
	const closing = /\n---[ \t]*\n/g;
	const match = closing.exec(text + '\n');
	if (match === null) {
		return null;
	}
	return {
		start: 0,
		end: Math.min(closing.lastIndex, text.length),
		kind: 'frontmatter',
	};
}

// Fenced code blocks and ATX headings, found by a single forward line scan so
// the logic stays linear and never backtracks.
function lineSpans(text: string): Span[] {
	const spans: Span[] = [];
	let offset = 0;
	let inFence = false;
	let fenceStart = 0;
	for (const line of text.split('\n')) {
		const lineStart = offset;
		const lineEnd = offset + line.length;
		const trimmed = line.trimStart();
		const isFence = trimmed.startsWith('```') || trimmed.startsWith('~~~');
		if (inFence) {
			if (isFence) {
				spans.push({ start: fenceStart, end: lineEnd, kind: 'code' });
				inFence = false;
			}
		} else if (isFence) {
			inFence = true;
			fenceStart = lineStart;
		} else if (/^#{1,6}(?:\s|$)/.test(trimmed)) {
			spans.push({ start: lineStart, end: lineEnd, kind: 'heading' });
		}
		offset = lineEnd + 1; // step past the '\n'
	}
	if (inFence) {
		// Unterminated fence: protect through end of document.
		spans.push({ start: fenceStart, end: text.length, kind: 'code' });
	}
	return spans;
}

// Inline code spans (`like this`). A single bounded character class, so linear.
function inlineCodeSpans(text: string): Span[] {
	const spans: Span[] = [];
	const re = /`[^`\n]+`/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		spans.push({ start: m.index, end: re.lastIndex, kind: 'code' });
	}
	return spans;
}

// HTML comments, `<!-- ... -->`, spanning one or more lines. Each comment is
// tagged as an Annoteca marker or a plain HTML comment, so the two can be masked
// independently. The body is matched lazily so each `-->` closes its own comment;
// an unterminated `<!--` is left unmasked rather than swallowing the rest of the
// note while the writer is still typing it. `wantAnnoteca`/`wantHtml` select which
// kinds to emit, so a disabled kind is never collected.
function commentSpans(
	text: string,
	wantAnnoteca: boolean,
	wantHtml: boolean,
): Span[] {
	const spans: Span[] = [];
	const re = /<!--[\s\S]*?-->/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		const isAnnoteca = ANNOTECA_OPENER.test(m[0]);
		if (isAnnoteca ? wantAnnoteca : wantHtml) {
			spans.push({
				start: m.index,
				end: re.lastIndex,
				kind: isAnnoteca ? ANNOTECA_COMMENT_KIND : HTML_COMMENT_KIND,
			});
		}
	}
	return spans;
}

// Merge overlapping or touching ranges into a sorted, non-overlapping list, so
// callers can skip a position by scanning once. The earlier span's kind wins.
function mergeSpans(spans: Span[]): Span[] {
	const sorted = [...spans].sort(
		(a, b) => a.start - b.start || a.end - b.end,
	);
	const merged: Span[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span.start <= last.end) {
			if (span.end > last.end) {
				last.end = span.end;
			}
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

// Code and frontmatter, found without a config.
//
// Per-file scoping has to run BEFORE the config is resolved, because the note's
// own `plumbline-profile` is what selects the profile. So it cannot call
// protectedSpans(), which takes a ResolvedConfig: that is a cycle. These three
// detectors take only text, which is what makes the cycle avoidable.
//
// It exists so a directive-shaped string inside a fence, an inline code span or
// the frontmatter block is read as the text it is. Documenting `<!-- plumbline:
// off -->` inside a fenced example is the obvious way to write about this
// feature, and without this it would silently stop linting the rest of the note.
//
// lint() ends up running these detectors twice, once here and once inside
// protectedSpans. Two linear passes over one note, which is cheaper than
// threading a partial span list through a function whose whole value is that
// it is pure over the text.
export function literalSpans(text: string): Span[] {
	const collected: Span[] = [];
	const frontmatter = frontmatterSpan(text);
	if (frontmatter) collected.push(frontmatter);
	for (const span of lineSpans(text)) {
		if (span.kind === 'code') collected.push(span);
	}
	collected.push(...inlineCodeSpans(text));
	return mergeSpans(collected);
}

// The protected-span pass: runs before any rule and returns the spans a rule or
// a metric must skip, filtered to the span kinds the profile has active.
export function protectedSpans(text: string, config: ResolvedConfig): Span[] {
	const kinds = new Set(config.protectedSpanKinds);
	const collected: Span[] = [];
	const frontmatter = frontmatterSpan(text);
	if (frontmatter && kinds.has('frontmatter')) {
		collected.push(frontmatter);
	}
	for (const span of lineSpans(text)) {
		if (kinds.has(span.kind)) {
			collected.push(span);
		}
	}
	if (kinds.has('code')) {
		collected.push(...inlineCodeSpans(text));
	}
	const wantAnnoteca = kinds.has(ANNOTECA_COMMENT_KIND);
	const wantHtml = kinds.has(HTML_COMMENT_KIND);
	if (wantAnnoteca || wantHtml) {
		// Scan for comments over text with the code, heading, and frontmatter
		// spans already blanked, so a `<!--` or `-->` sitting inside code cannot
		// pair with a delimiter in prose and swallow the text between them. Masking
		// preserves length, so the match offsets still map onto the source.
		const withoutProtected = maskSpans(text, mergeSpans(collected));
		collected.push(
			...commentSpans(withoutProtected, wantAnnoteca, wantHtml),
		);
	}
	if (kinds.has(SCRIPTURE_SPAN_KIND)) {
		collected.push(...scriptureSpans(text));
	}
	return mergeSpans(collected);
}

// Replace every protected span with spaces, keeping newlines so line structure
// and character offsets are preserved. Metrics and rules run over this masked
// text, so code and quoted material never pollute prose statistics. Assumes
// `spans` is sorted and non-overlapping (the output of protectedSpans).
export function maskSpans(text: string, spans: Span[]): string {
	if (spans.length === 0) {
		return text;
	}
	let result = '';
	let cursor = 0;
	for (const span of spans) {
		const start = Math.max(span.start, cursor);
		if (start > cursor) {
			result += text.slice(cursor, start);
		}
		const end = Math.min(span.end, text.length);
		if (end > start) {
			result += text.slice(start, end).replace(/[^\n]/g, ' ');
		}
		cursor = Math.max(cursor, end);
	}
	if (cursor < text.length) {
		result += text.slice(cursor);
	}
	return result;
}
