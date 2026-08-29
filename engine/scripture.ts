import { Rule, Span } from './types';
import { Citation, parseCitation } from './citation';

// The scripture pack. Its keystone is span detection: quoted verses are not the
// author's prose to edit, and they legitimately contain the words and structures
// the style rules flag ("truly, truly", "not X but Y", archaic phrasing). Every
// rule and every metric skips these spans. The verbatim-diff and verse-cap rules
// need the Bible corpus and land later; this ships the span detector, the
// devotional-register rule (ruleset rule 18), and citation extraction.
export const SCRIPTURE_PACK_ID = 'scripture';
export const SCRIPTURE_SPAN_KIND = 'scripture';

function isDoubleQuote(char: string | undefined): boolean {
	return char === '"' || char === '“' || char === '”';
}

function isDigit(char: string | undefined): boolean {
	return char !== undefined && char >= '0' && char <= '9';
}

function isSpace(char: string | undefined): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

// A citation carries a chapter:verse when a colon sits between two digits.
function hasChapterVerse(citation: string): boolean {
	for (let i = 1; i < citation.length - 1; i++) {
		if (
			citation[i] === ':' &&
			isDigit(citation[i - 1]) &&
			isDigit(citation[i + 1])
		) {
			return true;
		}
	}
	return false;
}

interface CitationMatch {
	content: string;
	open: number;
	close: number;
}

// Find every parenthetical carrying a chapter:verse, with its positions. Scanned
// with indexOf, never a greedy regex.
function findCitations(text: string): CitationMatch[] {
	const matches: CitationMatch[] = [];
	for (
		let open = text.indexOf('(');
		open !== -1;
		open = text.indexOf('(', open + 1)
	) {
		const close = text.indexOf(')', open + 1);
		if (close === -1) {
			break;
		}
		const content = text.slice(open + 1, close);
		if (hasChapterVerse(content)) {
			matches.push({ content, open, close });
		}
	}
	return matches;
}

// For a citation at `open`, find the quote that precedes it: the opening and
// closing double-quote offsets, or null when there is no quote before it. No
// lookbehind, no backtracking regex.
function precedingQuote(
	text: string,
	open: number,
): { openQuote: number; closeQuote: number } | null {
	let i = open - 1;
	while (i >= 0 && isSpace(text[i])) {
		i--;
	}
	if (i < 0 || !isDoubleQuote(text[i])) {
		return null;
	}
	let start = i - 1;
	while (start >= 0 && !isDoubleQuote(text[start])) {
		start--;
	}
	if (start < 0) {
		return null;
	}
	return { openQuote: start, closeQuote: i };
}

// Detect inline quoted scripture: a double-quoted span followed by a citation.
export function scriptureSpans(text: string): Span[] {
	const spans: Span[] = [];
	for (const match of findCitations(text)) {
		const quote = precedingQuote(text, match.open);
		if (quote) {
			spans.push({
				start: quote.openQuote,
				end: match.close + 1,
				kind: SCRIPTURE_SPAN_KIND,
			});
		}
	}
	return spans;
}

export interface ScriptureQuote {
	quote: string;
	citation: Citation;
	start: number;
	end: number;
}

// Every quoted verse with its parsed citation and the quoted text (between the
// quotes), for the verbatim-diff check.
export function scriptureQuotes(text: string): ScriptureQuote[] {
	const quotes: ScriptureQuote[] = [];
	for (const match of findCitations(text)) {
		const citation = parseCitation(match.content);
		const quote = precedingQuote(text, match.open);
		if (citation && quote) {
			quotes.push({
				quote: text.slice(quote.openQuote + 1, quote.closeQuote),
				citation,
				start: quote.openQuote,
				end: match.close + 1,
			});
		}
	}
	return quotes;
}

// Parse every scripture citation in the text (book, chapter, verses, translation).
export function scriptureReferences(text: string): Citation[] {
	const citations: Citation[] = [];
	for (const match of findCitations(text)) {
		const parsed = parseCitation(match.content);
		if (parsed) {
			citations.push(parsed);
		}
	}
	return citations;
}

// The scripture pack's style rules. Kept separate from the base vocabulary rule
// so a report names the rule that fired, and so a non-scripture profile can omit
// it. Devotional register creep (ruleset rule 18).
export const SCRIPTURE_RULES: Rule[] = [
	{
		slug: 'devotional-register',
		packId: SCRIPTURE_PACK_ID,
		category: 'C',
		severity: 'warning',
		message:
			'Devotional register creep. Cut it; usually no replacement is needed.',
		phrases: [
			'powerful reminder',
			'beautiful picture of',
			'invites us to',
			'speaks to us',
			'lean into',
			'spiritual journey',
			'deeper walk',
			'life-changing',
			'god laid it on my heart',
			'we serve a god who',
		],
	},
];
