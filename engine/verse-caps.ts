import { Citation, countVerses } from './citation';

// Copyright verse caps (ruleset rule 27): the total number of distinct verses a
// work may quote from a translation. ESV and NASB are verified against the
// rights-holder; the others the ruleset lists as unverified, so confirm before
// finalizing. Public-domain translations (KJV, ASV, WEB, ...) have no cap and are
// absent here. The per-book and percent-of-work limits need more data (book verse
// totals, work size) and come later.
export const VERSE_CAPS: Record<string, number> = {
	ESV: 500,
	NASB: 1000,
	NIV: 500,
	NLT: 500,
	CSB: 1000,
	NKJV: 500,
	NRSV: 500,
	MSG: 500,
};

export interface CapUsage {
	translation: string;
	verses: number;
	cap: number | null;
	exceeds: boolean;
	byBook: Record<string, number>;
}

// Aggregate every citation into distinct verses per translation (a verse quoted
// twice counts once, as copyright caps count distinct verses), and compare the
// total against the translation's cap.
export function summarizeCaps(citations: Citation[]): CapUsage[] {
	const perTranslation = new Map<
		string,
		{ verses: Set<string>; byBook: Map<string, Set<string>> }
	>();
	for (const citation of citations) {
		const key =
			citation.translation.length > 0 ? citation.translation : 'unknown';
		const entry = perTranslation.get(key) ?? {
			verses: new Set<string>(),
			byBook: new Map<string, Set<string>>(),
		};
		// Cap the loop so a malformed range cannot spin forever.
		const end = Math.min(
			citation.verseEnd,
			citation.verseStart + countVerses(citation) + 200,
		);
		for (let verse = citation.verseStart; verse <= end; verse++) {
			const reference = `${citation.book} ${citation.chapter}:${verse}`;
			entry.verses.add(reference);
			let bookSet = entry.byBook.get(citation.book);
			if (!bookSet) {
				bookSet = new Set<string>();
				entry.byBook.set(citation.book, bookSet);
			}
			bookSet.add(reference);
		}
		perTranslation.set(key, entry);
	}

	const result: CapUsage[] = [];
	for (const [translation, data] of perTranslation) {
		const cap = VERSE_CAPS[translation] ?? null;
		const byBook: Record<string, number> = {};
		for (const [book, set] of data.byBook) {
			byBook[book] = set.size;
		}
		result.push({
			translation,
			verses: data.verses.size,
			cap,
			exceeds: cap !== null && data.verses.size > cap,
			byBook,
		});
	}
	return result.sort((a, b) => b.verses - a.verses);
}
