import { Diagnostic, Severity } from './types';
import { SentenceSpan } from './sentences';

interface Range {
	start: number;
	end: number;
}

interface HeuristicRule {
	slug: string;
	packId: string;
	severity: Severity;
	message: string;
	run(text: string, sentences: SentenceSpan[]): Range[];
}

const HEURISTIC_PACK_ID = 'base';

// "It is not X" openers: a negation set up only to be corrected by the next
// sentence. Anchored, an alternation of literals.
const NEGATION_OPENER = /^(?:it is not|it's not|this is not|that is not)\b/i;

// The first `count` words of a sentence, normalized to single spaces, for
// comparing sentence openings.
function opening(text: string, count: number): string {
	return text.trim().split(/\s+/).slice(0, count).join(' ');
}

// The length in the ORIGINAL text of the first two words (with their real
// spacing), so the flagged range lands on the opening rather than the whole
// sentence. Falls back to the whole sentence when it has fewer than two words.
function openingLength(text: string): number {
	const match = /^\s*\S+\s+\S+/.exec(text);
	return match ? match[0].length : text.length;
}

export const HEURISTIC_RULES: HeuristicRule[] = [
	{
		slug: 'negation-assertion',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message:
			'Negation-assertion. Say the positive alone, or fold the contrast into one sentence.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (let i = 0; i < sentences.length - 1; i++) {
				const sentence = sentences[i];
				if (
					sentence &&
					NEGATION_OPENER.test(sentence.text.trimStart())
				) {
					ranges.push({ start: sentence.start, end: sentence.end });
				}
			}
			return ranges;
		},
	},
	{
		slug: 'anaphora',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message: 'Anaphora. Break the repeated opening on the second instance.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (let i = 1; i < sentences.length; i++) {
				const prev = sentences[i - 1];
				const curr = sentences[i];
				if (!prev || !curr) {
					continue;
				}
				const prevOpening = opening(prev.text, 2);
				if (
					prevOpening.length > 0 &&
					prevOpening.toLowerCase() ===
						opening(curr.text, 2).toLowerCase()
				) {
					ranges.push({
						start: curr.start,
						end: curr.start + openingLength(curr.text),
					});
				}
			}
			return ranges;
		},
	},
];

// Run the cross-sentence heuristics over the masked prose. Offsets map back onto
// the source, the same as the mechanical rules.
export function applyHeuristics(
	text: string,
	sentences: SentenceSpan[],
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const rule of HEURISTIC_RULES) {
		for (const range of rule.run(text, sentences)) {
			if (range.end > range.start) {
				diagnostics.push({
					ruleSlug: rule.slug,
					severity: rule.severity,
					start: range.start,
					end: range.end,
					message: rule.message,
					packId: rule.packId,
				});
			}
		}
	}
	return diagnostics;
}
