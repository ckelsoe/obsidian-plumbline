import { Diagnostic, Severity } from './types';
import { CONFIDENCE } from './rollup';
import { atWordEdges } from './apply-rules';
import {
	SentenceSpan,
	ParagraphSpan,
	splitParagraphsWithOffsets,
} from './sentences';

interface Range {
	start: number;
	end: number;
	// The replacement for the whole range, when there is exactly one right
	// answer (a doubled word collapses to its first copy). Absent for every
	// heuristic that flags a judgment call.
	fix?: string;
}

interface HeuristicRule {
	slug: string;
	packId: string;
	severity: Severity;
	message: string;
	// Omitted means the heuristic default (see CONFIDENCE in rollup.ts). Set it
	// only where a rule decides differently from its neighbours, which here means
	// the two judgment-tier notes.
	confidence?: number;
	run(
		text: string,
		sentences: SentenceSpan[],
		paragraphs: ParagraphSpan[],
		protectedRanges: readonly Range[],
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

// A word typed twice in a row ("the the"), the slip the eye skips when the
// copies sit at one line's end and the next line's start. Words are matched one
// at a time and each neighbouring pair compared, rather than with a
// backreference pattern, which backtracks super-linearly.
// A word is a run of Unicode letters, so "café café" is caught whole. A
// contraction is one word with either apostrophe, so "can can’t" is not read as
// a doubled "can".
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

// The gap between two copies: plain whitespace with at most one line break, so
// a doubled word across a paragraph break is not flagged. Checked by hand rather
// than with a pattern of optional whitespace runs, which backtracks.
function isDoubledGap(gap: string): boolean {
	// CRLF, LF, and a lone CR (old Mac files) each count as one line break.
	return /^[ \t\r\n]+$/.test(gap) && gap.split(/\r\n|\r|\n/).length <= 2;
}

// True when [start, end) touches a protected span. Protected text reaches the
// heuristics masked to spaces, so "the `x` the" looks like "the", spaces, "the";
// only the spans themselves can tell that gap from typed whitespace, and a fix
// over it would delete the protected text.
function touchesProtected(
	start: number,
	end: number,
	protectedRanges: readonly Range[],
): boolean {
	return protectedRanges.some((r) => r.start < end && r.end > start);
}

// Words correctly doubled in ordinary English ("he had had enough", "she said
// that that was fine", "what it is is plain") or reduplicated on purpose
// ("there, there" without the comma, "no no", "knock knock").
const LEGITIMATE_DOUBLES = new Set([
	'had',
	'that',
	'do',
	'is',
	'there',
	'now',
	'no',
	'so',
	'bye',
	'knock',
	'tut',
	'ha',
	'blah',
	'yeah',
]);

// Both copies capitalized is the shape of a place name ("Walla Walla", "Bora
// Bora"). A doubled article at a sentence start ("The the") has only the first
// copy capitalized and is still flagged. One letter is never a name, so "I I"
// is flagged too.
function isNameWord(word: string): boolean {
	// By code point, so a letter outside the Basic Multilingual Plane is one
	// letter, not two halves that are neither upper- nor lower-case.
	const letters = Array.from(word);
	const first = letters[0] ?? '';
	return (
		letters.length > 1 &&
		first !== first.toLowerCase() &&
		first === first.toUpperCase()
	);
}

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
		slug: 'repeated-word',
		packId: HEURISTIC_PACK_ID,
		severity: 'warning',
		message: 'Repeated word. Delete the second copy.',
		// A pattern, not a reading: the word is doubled or it is not.
		confidence: CONFIDENCE.mechanical,
		run: (text, _sentences, _paragraphs, protectedRanges) => {
			const ranges: Range[] = [];
			const matcher = new RegExp(WORD.source, 'gu');
			let prev: { word: string; start: number; end: number } | null =
				null;
			for (
				let m = matcher.exec(text);
				m !== null;
				m = matcher.exec(text)
			) {
				const start = m.index;
				const end = matcher.lastIndex;
				// Whole words only: letters glued to a digit or underscore
				// ("the2") are part of a longer token and break the chain.
				if (!atWordEdges(text, start, end)) {
					prev = null;
					continue;
				}
				const word = m[0];
				if (
					prev !== null &&
					prev.word.toLowerCase() === word.toLowerCase() &&
					isDoubledGap(text.slice(prev.end, start)) &&
					!touchesProtected(prev.end, start, protectedRanges) &&
					!LEGITIMATE_DOUBLES.has(word.toLowerCase()) &&
					!(isNameWord(prev.word) && isNameWord(word))
				) {
					ranges.push({ start: prev.start, end, fix: prev.word });
					// A tripled word gives one finding, not two overlapping ones
					// whose fixes would fight; the fix leaves a pair, flagged next.
					prev = null;
					continue;
				}
				prev = { word, start, end };
			}
			return ranges;
		},
	},
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
		// Judgment tier, same reasoning as anchor-test below.
		confidence: CONFIDENCE.judgment,
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
		// Judgment tier: it reads abstraction, not a pattern, and is wrong often
		// enough that it must not outrank a mechanical rule at equal count.
		confidence: CONFIDENCE.judgment,
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

// The confidence a heuristic declares, or undefined to take the default. Exported
// so lint() can resolve a slug's confidence without importing the whole record set.
export function heuristicConfidence(slug: string): number | undefined {
	return HEURISTIC_RULES.find((r) => r.slug === slug)?.confidence;
}

// Run the cross-sentence heuristics over the masked prose. Offsets map back onto
// the source, the same as the mechanical rules. A heuristic whose slug is in
// `disabled` is skipped, so it can be toggled from the vault config like any rule.
// A slug in `severityBySlug` fires at the overridden severity instead of the
// record's default: a mechanical rule carries its group-tuned severity on a copied
// record, but a heuristic is resolved here, so its override is applied at this point.
// `protectedRanges` are the masked spans, for a heuristic that must not reach
// across one (repeated-word).
export function applyHeuristics(
	text: string,
	sentences: SentenceSpan[],
	disabled: Set<string> = new Set(),
	severityBySlug: Record<string, Severity> = {},
	protectedRanges: readonly Range[] = [],
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const paragraphs = splitParagraphsWithOffsets(text);
	for (const rule of HEURISTIC_RULES) {
		if (disabled.has(rule.slug)) {
			continue;
		}
		const severity = severityBySlug[rule.slug] ?? rule.severity;
		for (const range of rule.run(
			text,
			sentences,
			paragraphs,
			protectedRanges,
		)) {
			if (range.end > range.start) {
				diagnostics.push({
					ruleSlug: rule.slug,
					severity,
					start: range.start,
					end: range.end,
					message: rule.message,
					packId: rule.packId,
					...(range.fix === undefined ? {} : { fix: range.fix }),
				});
			}
		}
	}
	return diagnostics;
}
