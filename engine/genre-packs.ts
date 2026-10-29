import { Rule, Span } from './types';
import { BASE_PACK_ID, BASE_RULES } from './packs';
import {
	SCRIPTURE_PACK_ID,
	SCRIPTURE_RULES,
	SCRIPTURE_SPAN_KIND,
} from './scripture';

// The genre packs: phrase rules for one kind of writing, added on top of the
// base pack by the groups that extend them. Like the base pack, rules are data.
// Each list keeps to phrases that are wrong (or a tell) nearly every time they
// appear in that genre, because a pack that cries wolf gets turned off.
export const BUSINESS_PACK_ID = 'business';
export const TECHNICAL_PACK_ID = 'technical';
export const FICTION_PACK_ID = 'fiction';
export const MARKETING_PACK_ID = 'marketing';

// Quoted speech, masked in groups that extend the fiction pack. A character's
// line is their voice, not the writer's, so it should not be judged as the
// writer's prose.
export const DIALOGUE_SPAN_KIND = 'dialogue';

// Every subject pronoun, for the fiction rules that pair a pronoun with a verb.
const PRONOUNS = ['i', 'he', 'she', 'they', 'we', 'you'];

function withPronouns(verbs: readonly string[]): string[] {
	return PRONOUNS.flatMap((pronoun) =>
		verbs.map((verb) => `${pronoun} ${verb}`),
	);
}

export const BUSINESS_RULES: Rule[] = [
	{
		slug: 'business-jargon',
		packId: BUSINESS_PACK_ID,
		category: 'C',
		severity: 'warning',
		message: 'Business jargon. Say the plain thing it stands for.',
		phrases: [
			'synergy',
			'synergies',
			'synergize',
			'circle back',
			'touch base',
			'move the needle',
			'low-hanging fruit',
			'deep dive',
			'value-add',
			'paradigm shift',
			'think outside the box',
			'at the end of the day',
			'boil the ocean',
			'drink from the firehose',
			'take this offline',
			'run it up the flagpole',
			'open the kimono',
			'best practices',
			'core competency',
			'core competencies',
			'mission-critical',
			'actionable insights',
		],
		replace: {
			'touch base': 'talk',
			'circle back': 'follow up',
			'deep dive': 'close look',
			'take this offline': 'talk about this separately',
		},
	},
	{
		slug: 'soft-opener',
		packId: BUSINESS_PACK_ID,
		category: 'C',
		severity: 'suggestion',
		message: 'Soft opener. Lead with the ask or the news.',
		phrases: [
			'just checking in',
			'just following up',
			'just wanted to',
			'i hope this email finds you well',
			'i hope this finds you well',
			'per my last email',
			'as per my last email',
			'i wanted to reach out',
		],
	},
];

export const TECHNICAL_RULES: Rule[] = [
	{
		slug: 'minimizer',
		packId: TECHNICAL_PACK_ID,
		category: 'C',
		severity: 'warning',
		message:
			'Minimizer. What is easy for you may not be for the reader. Cut it.',
		phrases: [
			'simply',
			'obviously',
			'of course',
			'it is easy to',
			"it's easy to",
			'just run',
			'just add',
			'just use',
			'just click',
			'just type',
			'trivially',
		],
	},
	{
		slug: 'future-tense-instruction',
		packId: TECHNICAL_PACK_ID,
		category: 'C',
		severity: 'suggestion',
		message:
			'Future tense in an instruction. Say what happens, in the present: "the page opens".',
		phrases: [
			'will be displayed',
			'will be shown',
			'will be created',
			'will be returned',
			'will appear',
			'will open',
			'will now',
		],
		// No fixes: the present tense depends on the subject's number ("the
		// file opens", "the files open"), which a phrase match cannot see.
	},
	{
		slug: 'please-in-instructions',
		packId: TECHNICAL_PACK_ID,
		category: 'C',
		severity: 'suggestion',
		message: 'Politeness filler in documentation. Give the instruction.',
		phrases: ['please note', 'please refer to', 'please see', 'kindly'],
		replace: {
			'please refer to': 'see',
			'please see': 'see',
		},
	},
];

export const FICTION_RULES: Rule[] = [
	{
		slug: 'stock-fiction-phrase',
		packId: FICTION_PACK_ID,
		category: 'A',
		severity: 'warning',
		message:
			'Stock phrase. It reads as generated. Show the moment in your own words.',
		phrases: [
			"a breath she didn't know she was holding",
			"a breath he didn't know he was holding",
			"a breath they didn't know they were holding",
			"a breath i didn't know i was holding",
			'a shiver ran down',
			'shivers down her spine',
			'shivers down his spine',
			'a smile tugged at',
			'the corners of her mouth',
			'the corners of his mouth',
			'barely above a whisper',
			'the air was thick with',
			'time seemed to slow',
			'something shifted',
			'eyes widened',
			'jaw tightened',
			'jaw clenched',
			'voice dripping with',
			'a wave of relief',
			'a pang of',
			'heart hammered',
			'padded across',
			'the weight of it all',
		],
	},
	{
		slug: 'filter-word',
		packId: FICTION_PACK_ID,
		category: 'A',
		severity: 'suggestion',
		message:
			'Filter word. Drop the observer and show what was seen or felt.',
		phrases: withPronouns([
			'saw',
			'felt',
			'noticed',
			'realized',
			'heard',
			'watched',
			'wondered',
		]),
		confidence: 0.5,
	},
	{
		slug: 'said-bookism',
		packId: FICTION_PACK_ID,
		category: 'A',
		severity: 'suggestion',
		message:
			'Showy dialogue tag. "Said" disappears; let the line carry the tone.',
		phrases: [
			...withPronouns([
				'exclaimed',
				'retorted',
				'interjected',
				'opined',
				'chortled',
				'expostulated',
			]),
			'said softly',
			'said quietly',
			'said angrily',
			'said sadly',
			'said firmly',
			'said gently',
			'said coldly',
		],
	},
];

export const MARKETING_RULES: Rule[] = [
	{
		slug: 'hype-word',
		packId: MARKETING_PACK_ID,
		category: 'C',
		severity: 'warning',
		message: 'Hype word. Name the specific benefit instead.',
		phrases: [
			// Only the figurative uses. A bare "unlock" or "elevate" is often
			// literal ("unlock the door with your phone").
			'unlock your',
			'unlock the power',
			'unlock new',
			'elevate your',
			'elevates your',
			'seamless',
			'seamlessly',
			'game-changing',
			'game changer',
			'game-changer',
			'cutting-edge',
			'revolutionary',
			'next-level',
			'world-class',
			'best-in-class',
			'supercharge',
			'supercharges',
			'empower',
			'empowers',
			'effortlessly',
		],
	},
	{
		slug: 'marketing-opener',
		packId: MARKETING_PACK_ID,
		category: 'A',
		severity: 'warning',
		message: 'Stock marketing opener. Open on the reader’s actual problem.',
		phrases: [
			"in today's fast-paced world",
			"in today's digital age",
			"in today's world",
			'look no further',
			"whether you're a",
			'take it to the next level',
			'are you tired of',
		],
	},
];

// Every pack's phrase rules, keyed by pack id. The one place a pack is
// registered: the resolver, the settings list, and the custom-check slug guard
// all read it, so a new pack cannot be half wired.
export const PACK_RULES: Readonly<Record<string, readonly Rule[]>> = {
	[BASE_PACK_ID]: BASE_RULES,
	[SCRIPTURE_PACK_ID]: SCRIPTURE_RULES,
	[BUSINESS_PACK_ID]: BUSINESS_RULES,
	[TECHNICAL_PACK_ID]: TECHNICAL_RULES,
	[FICTION_PACK_ID]: FICTION_RULES,
	[MARKETING_PACK_ID]: MARKETING_RULES,
};

// The extra protected-span kind a pack contributes, beyond the base kinds.
export const PACK_EXTRA_SPAN_KINDS: Readonly<Record<string, string[]>> = {
	[SCRIPTURE_PACK_ID]: [SCRIPTURE_SPAN_KIND],
	[FICTION_PACK_ID]: [DIALOGUE_SPAN_KIND],
};

// The packs a group can add to the base pack, in settings order, with the label
// and help text the group editor shows.
export const OPTIONAL_PACKS: readonly {
	id: string;
	name: string;
	desc: string;
}[] = [
	{
		id: SCRIPTURE_PACK_ID,
		name: 'Include scripture checks',
		desc: 'Verse caps, blended quotation, verbatim scripture, and the devotional-register check.',
	},
	{
		id: BUSINESS_PACK_ID,
		name: 'Include business checks',
		desc: 'Business jargon and soft email openers.',
	},
	{
		id: TECHNICAL_PACK_ID,
		name: 'Include technical checks',
		desc: 'Minimizers like "simply", future tense in instructions, and politeness filler.',
	},
	{
		id: FICTION_PACK_ID,
		name: 'Include fiction checks',
		desc: 'Stock phrases, filter words, and showy dialogue tags. Also leaves quoted dialogue unchecked.',
	},
	{
		id: MARKETING_PACK_ID,
		name: 'Include marketing checks',
		desc: 'Hype words and stock marketing openers.',
	},
];

// Every built-in phrase rule across all packs.
export const ALL_PACK_RULES: readonly Rule[] = Object.values(PACK_RULES).flat();

// Whether the line starting at `from` is blank: only spaces, tabs, or a CR
// before its newline (or the end of the text). A line of stray spaces still
// separates paragraphs in Markdown.
function blankLineAfter(text: string, from: number): boolean {
	for (let j = from; j < text.length; j++) {
		const c = text[j];
		if (c === '\n') {
			return true;
		}
		if (c !== ' ' && c !== '\t' && c !== '\r') {
			return false;
		}
	}
	return true;
}

function isDoubleQuote(char: string): boolean {
	return char === '"' || char === '“' || char === '”';
}

// Quoted dialogue: each double-quoted stretch within a paragraph, straight or
// curly. A quote left open at the end of a paragraph runs to that paragraph's
// end, which is the convention for one character's speech continuing into the
// next paragraph (each paragraph opens a quote and only the last closes it).
// A single linear scan; no regex, so nothing to backtrack.
//
// `quotes` is the same text with protected spans blanked, so a quote character
// inside code opens nothing. Paragraph breaks are still read from `text`:
// blanking a line of inline code would otherwise fake a blank line and end a
// speech early.
export function dialogueSpans(text: string, quotes: string = text): Span[] {
	const spans: Span[] = [];
	let open: number | null = null;
	for (let i = 0; i < text.length; i++) {
		const char = quotes[i] ?? '';
		// A blank line ends the paragraph, and with it any open quote.
		if (text[i] === '\n' && open !== null && blankLineAfter(text, i + 1)) {
			spans.push({ start: open, end: i, kind: DIALOGUE_SPAN_KIND });
			open = null;
			continue;
		}
		if (!isDoubleQuote(char)) {
			continue;
		}
		if (open === null) {
			open = i;
		} else {
			spans.push({ start: open, end: i + 1, kind: DIALOGUE_SPAN_KIND });
			open = null;
		}
	}
	if (open !== null) {
		spans.push({ start: open, end: text.length, kind: DIALOGUE_SPAN_KIND });
	}
	return spans;
}
