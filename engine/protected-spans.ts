import { ResolvedConfig, Span } from './types';
import { scriptureSpans, SCRIPTURE_SPAN_KIND } from './scripture';

// The base protected-span sources every profile starts with. Packs contribute
// more (scripture quotes, dialogue); a profile selects which are active.
export const BASE_SPAN_KINDS = [
	'frontmatter',
	'code',
	'heading',
	'html-comment',
] as const;

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

// HTML comments, `<!-- ... -->`, spanning one or more lines. This is also how
// Annoteca stores every comment (`<!-- annoteca/<category>: [id=...] -->`), so
// masking HTML comments keeps every rule and metric out of comment text and out
// of another plugin's markers. The body is matched lazily so each `-->` closes
// its own comment; an unterminated `<!--` is left unmasked rather than swallowing
// the rest of the note while the writer is still typing it.
function htmlCommentSpans(text: string): Span[] {
	const spans: Span[] = [];
	const re = /<!--[\s\S]*?-->/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		spans.push({
			start: m.index,
			end: re.lastIndex,
			kind: 'html-comment',
		});
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
	if (kinds.has('html-comment')) {
		collected.push(...htmlCommentSpans(text));
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
