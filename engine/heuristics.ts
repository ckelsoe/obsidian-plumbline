import { Diagnostic, Severity } from './types';
import {
	SentenceSpan,
	ParagraphSpan,
	splitParagraphsWithOffsets,
} from './sentences';

interface Range {
	start: number;
	end: number;
}

interface HeuristicRule {
	slug: string;
	packId: string;
	severity: Severity;
	message: string;
	run(
		text: string,
		sentences: SentenceSpan[],
		paragraphs: ParagraphSpan[],
	): Range[];
}

// Paragraph-initial transitions (ruleset rule 16), and whole-sentence emphasis
// fragments (rule 4).
const TRANSITION_OPENER =
	/^(?:however|moreover|furthermore|additionally|consequently|nevertheless|nonetheless|therefore|thus|indeed),/i;

const EMPHASIS_FRAGMENTS = new Set([
	'period',
	'full stop',
	'already',
	'done',
	'not anymore',
	'never again',
	'end of story',
	'exactly',
	'precisely',
	'one question',
	'one answer',
]);

function stripTerminalPunctuation(text: string): string {
	let end = text.length;
	while (
		end > 0 &&
		(text[end - 1] === '.' ||
			text[end - 1] === '!' ||
			text[end - 1] === '?')
	) {
		end--;
	}
	return text.slice(0, end);
}

const HEURISTIC_PACK_ID = 'base';

// "It is not X" openers: a negation set up only to be corrected by the next
// sentence. Anchored, an alternation of literals.
const NEGATION_OPENER = /^(?:it is not|it's not|this is not|that is not)\b/i;

// A rhetorical-question pivot: an application bridge like "But what does this
// mean for us today?"
const RHETORICAL_PIVOT =
	/^(?:but |so |and |now |yet )?(?:what|how|why|where|who)\b/i;

// A demonstrative opener: a sentence led by a bare "This/That/These/Those" with a
// linking or action verb rather than a noun attached.
const DEMONSTRATIVE_OPENER =
	/^(?:this|that|these|those)\s+(?:is|are|was|were|means|shows|reflects|reveals|points|leads|creates|gives|becomes|matters)\b/i;

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

// Judgment-tier detectors (ruleset rules 12 and 37). Fuzzy by nature: a tool can
// only flag candidates, so these are suggestions.
const FIRST_PERSON = new Set(['i', 'my', 'me', 'we', 'our', 'us', 'myself']);
const MONTHS = new Set([
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
]);
const ABSTRACT_SUFFIXES = ['ion', 'ment', 'ness', 'ity', 'ance', 'ence'];

function words(text: string): string[] {
	return text
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0);
}

// Strip leading and trailing non-letter characters from a word.
function cleanWord(word: string): string {
	const isLetter = (char: string): boolean =>
		(char >= 'A' && char <= 'Z') ||
		(char >= 'a' && char <= 'z') ||
		char === "'";
	let start = 0;
	let end = word.length;
	while (start < end && !isLetter(word[start] ?? '')) {
		start++;
	}
	while (end > start && !isLetter(word[end - 1] ?? '')) {
		end--;
	}
	return word.slice(start, end);
}

function hasDigit(word: string): boolean {
	for (const char of word) {
		if (char >= '0' && char <= '9') {
			return true;
		}
	}
	return false;
}

// A concrete anchor: a proper noun (a capitalized word not at the sentence start
// and not "I"), a number, or a month name.
function hasConcreteAnchor(sentenceWords: string[]): boolean {
	for (let i = 0; i < sentenceWords.length; i++) {
		const raw = sentenceWords[i] ?? '';
		if (hasDigit(raw)) {
			return true;
		}
		const clean = cleanWord(raw);
		const capitalized =
			clean.length > 1 &&
			clean[0] !== undefined &&
			clean[0] >= 'A' &&
			clean[0] <= 'Z';
		if (i > 0 && capitalized && clean !== 'I') {
			return true;
		}
		if (MONTHS.has(clean.toLowerCase())) {
			return true;
		}
	}
	return false;
}

function isAbstractNoun(word: string): boolean {
	const lower = cleanWord(word).toLowerCase();
	return (
		lower.length > 5 && ABSTRACT_SUFFIXES.some((suf) => lower.endsWith(suf))
	);
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
	{
		slug: 'rhetorical-pivot',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message: 'Rhetorical-question pivot. Turn on a specific instead.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (const sentence of sentences) {
				const trimmed = sentence.text.trim();
				if (trimmed.endsWith('?') && RHETORICAL_PIVOT.test(trimmed)) {
					ranges.push({ start: sentence.start, end: sentence.end });
				}
			}
			return ranges;
		},
	},
	{
		slug: 'demonstrative-opener',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message:
			'Demonstrative opener. Name the subject rather than a bare "This".',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (const sentence of sentences) {
				if (DEMONSTRATIVE_OPENER.test(sentence.text.trimStart())) {
					ranges.push({
						start: sentence.start,
						end: sentence.start + openingLength(sentence.text),
					});
				}
			}
			return ranges;
		},
	},
	{
		slug: 'transitional-stacking',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message: 'Transitional stacking. Delete the opener and check the join.',
		run: (_text, _sentences, paragraphs) => {
			const ranges: Range[] = [];
			for (const paragraph of paragraphs) {
				const match = TRANSITION_OPENER.exec(paragraph.text);
				if (match) {
					ranges.push({
						start: paragraph.start,
						end: paragraph.start + match[0].length,
					});
				}
			}
			return ranges;
		},
	},
	{
		slug: 'formatting-tells',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message:
			'Formatting tell. Consecutive bold-led paragraphs; write prose.',
		run: (_text, _sentences, paragraphs) => {
			const ranges: Range[] = [];
			for (let i = 1; i < paragraphs.length; i++) {
				const prev = paragraphs[i - 1];
				const curr = paragraphs[i];
				if (
					prev &&
					curr &&
					prev.text.startsWith('**') &&
					curr.text.startsWith('**')
				) {
					ranges.push({
						start: curr.start,
						end: curr.start + Math.min(curr.text.length, 40),
					});
				}
			}
			return ranges;
		},
	},
	{
		slug: 'emphasis-fragment',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message: 'Emphasis by fragment. Cut it.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (const sentence of sentences) {
				const core = stripTerminalPunctuation(sentence.text.trim())
					.trim()
					.toLowerCase();
				if (EMPHASIS_FRAGMENTS.has(core)) {
					ranges.push({ start: sentence.start, end: sentence.end });
				}
			}
			return ranges;
		},
	},
	{
		slug: 'personal-claims-vague',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message:
			'Vague personal claim. Add a specific: a name, a date, a place.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (const sentence of sentences) {
				const sentenceWords = words(sentence.text);
				if (sentenceWords.length < 7) {
					continue;
				}
				const firstPerson = sentenceWords.some((word) =>
					FIRST_PERSON.has(cleanWord(word).toLowerCase()),
				);
				if (firstPerson && !hasConcreteAnchor(sentenceWords)) {
					ranges.push({ start: sentence.start, end: sentence.end });
				}
			}
			return ranges;
		},
	},
	{
		slug: 'anchor-test',
		packId: HEURISTIC_PACK_ID,
		severity: 'suggestion',
		message: 'Abstract, no anchor. Rewrite onto a concrete particular.',
		run: (_text, sentences) => {
			const ranges: Range[] = [];
			for (const sentence of sentences) {
				const sentenceWords = words(sentence.text);
				const abstract = sentenceWords.filter(isAbstractNoun).length;
				if (abstract >= 3 && !hasConcreteAnchor(sentenceWords)) {
					ranges.push({ start: sentence.start, end: sentence.end });
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
	const paragraphs = splitParagraphsWithOffsets(text);
	for (const rule of HEURISTIC_RULES) {
		for (const range of rule.run(text, sentences, paragraphs)) {
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
