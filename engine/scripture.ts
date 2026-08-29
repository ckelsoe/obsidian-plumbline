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

// Detect inline quoted scripture: a double-quoted span (straight or curly)
// followed by a citation. For each citation, walk back to the quote that
// precedes it. No lookbehind, no backtracking regex.
export function scriptureSpans(text: string): Span[] {
	const spans: Span[] = [];
	for (const match of findCitations(text)) {
		// Walk back over whitespace to the closing quote before the citation.
		let i = match.open - 1;
		while (i >= 0 && isSpace(text[i])) {
			i--;
		}
		if (i < 0 || !isDoubleQuote(text[i])) {
			continue;
		}
		// Walk back to the opening quote.
		let start = i - 1;
		while (start >= 0 && !isDoubleQuote(text[start])) {
			start--;
		}
		if (start < 0) {
			continue;
		}
		spans.push({ start, end: match.close + 1, kind: SCRIPTURE_SPAN_KIND });
	}
	return spans;
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
