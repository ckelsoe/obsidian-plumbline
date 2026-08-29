import { summarizeCaps } from '../engine/verse-caps';
import { Citation } from '../engine/citation';

function cite(
	translation: string,
	book: string,
	chapter: number,
	verseStart: number,
	verseEnd = verseStart,
): Citation {
	return { translation, book, chapter, verseStart, verseEnd };
}

describe('summarizeCaps', () => {
	it('counts distinct verses per translation', () => {
		const usage = summarizeCaps([
			cite('ESV', 'John', 3, 16),
			cite('ESV', 'John', 3, 16), // duplicate, counts once
			cite('ESV', 'John', 3, 17),
			cite('NIV', 'Psalm', 23, 1, 6), // six verses
		]);
		expect(usage.find((u) => u.translation === 'ESV')?.verses).toBe(2);
		expect(usage.find((u) => u.translation === 'NIV')?.verses).toBe(6);
	});

	it('flags a translation over its cap', () => {
		const many: Citation[] = [];
		for (let v = 1; v <= 501; v++) {
			many.push(cite('ESV', 'Psalm', 119, v));
		}
		const esv = summarizeCaps(many).find((u) => u.translation === 'ESV');
		expect(esv?.cap).toBe(500);
		expect(esv?.verses).toBe(501);
		expect(esv?.exceeds).toBe(true);
	});

	it('does not flag a public-domain translation with no cap', () => {
		const kjv = summarizeCaps([cite('KJV', 'John', 3, 16)]).find(
			(u) => u.translation === 'KJV',
		);
		expect(kjv?.cap).toBeNull();
		expect(kjv?.exceeds).toBe(false);
	});
});
