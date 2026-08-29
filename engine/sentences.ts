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
