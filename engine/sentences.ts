import { SENTENCE_END } from './sentence-stats';

// A sentence with its character offsets in the source, so cross-sentence rules
// can flag a precise range. Offsets are into the masked prose the engine passes
// in, which preserves the original document's offsets.
export interface SentenceSpan {
	text: string;
	start: number;
	end: number;
}

// Split prose into sentences while tracking offsets. Walks whitespace-separated
// tokens and closes a sentence at the first token ending in terminal punctuation,
// the same segmentation sentence-stats uses, so metrics and heuristics agree.
export function splitSentencesWithOffsets(text: string): SentenceSpan[] {
	const sentences: SentenceSpan[] = [];
	const tokens = /\S+/g;
	let start = -1;
	let end = -1;
	for (let m = tokens.exec(text); m !== null; m = tokens.exec(text)) {
		if (start === -1) {
			start = m.index;
		}
		end = tokens.lastIndex;
		if (SENTENCE_END.test(m[0] ?? '')) {
			sentences.push({ text: text.slice(start, end), start, end });
			start = -1;
		}
	}
	if (start !== -1) {
		sentences.push({ text: text.slice(start, end), start, end });
	}
	return sentences;
}

export interface ParagraphSpan {
	text: string;
	start: number;
	end: number;
}

function isWhitespace(char: string | undefined): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

// Trim whitespace off a [from, to) range and return the tight span, or null when
// the range is all whitespace.
function tightSpan(
	text: string,
	from: number,
	to: number,
): ParagraphSpan | null {
	let start = from;
	let end = to;
	while (start < end && isWhitespace(text[start])) {
		start++;
	}
	while (end > start && isWhitespace(text[end - 1])) {
		end--;
	}
	if (end <= start) {
		return null;
	}
	return { text: text.slice(start, end), start, end };
}

// Split prose into paragraphs on blank lines, tracking offsets. Paragraph-level
// rules (transitional stacking, formatting tells) run over these.
export function splitParagraphsWithOffsets(text: string): ParagraphSpan[] {
	const paragraphs: ParagraphSpan[] = [];
	const blankLine = /\n[ \t]*\n/g;
	let start = 0;
	for (let m = blankLine.exec(text); m !== null; m = blankLine.exec(text)) {
		const span = tightSpan(text, start, m.index);
		if (span) {
			paragraphs.push(span);
		}
		start = blankLine.lastIndex;
	}
	const tail = tightSpan(text, start, text.length);
	if (tail) {
		paragraphs.push(tail);
	}
	return paragraphs;
}
