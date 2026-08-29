// Scripture citation parsing and verse-usage counting. This is the foundation
// for the copyright verse-cap rule (rule 27) and, later, the verbatim-diff rule
// (rule 26): both start from a structured citation. Whole-work cap flagging and
// corpus comparison come later; this counts what a single note quotes.

export interface Citation {
	translation: string;
	book: string;
	chapter: number;
	verseStart: number;
	verseEnd: number;
}

// Parse a citation parenthetical's contents, e.g. "John 6:47, ESV" or
// "1 John 3:16-18, NIV", into structured fields. Returns null without a
// chapter:verse. Parsed with string ops, no backtracking regex.
// A translation is a short alphanumeric code (ESV, NASB, NKJV), not a phrase or a
// second reference. This keeps a multi-reference parenthetical like
// "(1 Timothy 3:1, Titus 1:5)" from treating "Titus 1:5" as the translation.
function isTranslationCode(text: string): boolean {
	if (text.length === 0 || text.length > 6) {
		return false;
	}
	let hasLetter = false;
	for (const char of text) {
		const letter =
			(char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');
		const digit = char >= '0' && char <= '9';
		if (!letter && !digit) {
			return false;
		}
		if (letter) {
			hasLetter = true;
		}
	}
	// A bare number (a chapter or verse fragment) is not a translation.
	return hasLetter;
}

export function parseCitation(citation: string): Citation | null {
	const parts = citation
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	const reference = parts[0] ?? '';
	const lastPart = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
	const translation = isTranslationCode(lastPart) ? lastPart : '';

	const tokens = reference.split(/\s+/);
	let refToken = '';
	let bookTokens: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		if ((tokens[i] ?? '').includes(':')) {
			refToken = tokens[i] ?? '';
			bookTokens = tokens.slice(0, i);
			break;
		}
	}
	if (refToken === '' || bookTokens.length === 0) {
		return null;
	}

	const [chapterText, verseText] = refToken.split(':');
	const chapter = Number.parseInt(chapterText ?? '', 10);
	const verseBits = (verseText ?? '').split('-');
	const verseStart = Number.parseInt(verseBits[0] ?? '', 10);
	const verseEnd =
		verseBits.length > 1
			? Number.parseInt(verseBits[1] ?? '', 10)
			: verseStart;
	if (!Number.isFinite(chapter) || !Number.isFinite(verseStart)) {
		return null;
	}
	return {
		translation,
		book: bookTokens.join(' '),
		chapter,
		verseStart,
		verseEnd: Number.isFinite(verseEnd) ? verseEnd : verseStart,
	};
}

// Number of verses a citation spans (inclusive).
export function countVerses(citation: Citation): number {
	return Math.max(1, citation.verseEnd - citation.verseStart + 1);
}

function formatReference(citation: Citation): string {
	const range =
		citation.verseEnd !== citation.verseStart
			? `${citation.verseStart}-${citation.verseEnd}`
			: `${citation.verseStart}`;
	return `${citation.book} ${citation.chapter}:${range}`;
}

export interface TranslationUsage {
	verses: number;
	references: string[];
}

export interface ScriptureUsage {
	byTranslation: Record<string, TranslationUsage>;
	totalVerses: number;
}

// Aggregate parsed citations into per-translation verse counts.
export function summarizeScripture(citations: Citation[]): ScriptureUsage {
	const byTranslation: Record<string, TranslationUsage> = {};
	let totalVerses = 0;
	for (const citation of citations) {
		const key =
			citation.translation.length > 0 ? citation.translation : 'unknown';
		const entry = byTranslation[key] ?? { verses: 0, references: [] };
		const count = countVerses(citation);
		entry.verses += count;
		entry.references.push(formatReference(citation));
		byTranslation[key] = entry;
		totalVerses += count;
	}
	return { byTranslation, totalVerses };
}
