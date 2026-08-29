import {
	parseCitation,
	countVerses,
	summarizeScripture,
	Citation,
} from '../engine/citation';

describe('parseCitation', () => {
	it('parses a single verse with translation', () => {
		expect(parseCitation('John 6:47, ESV')).toEqual({
			translation: 'ESV',
			book: 'John',
			chapter: 6,
			verseStart: 47,
			verseEnd: 47,
		});
	});

	it('parses a verse range and a multi-word book', () => {
		expect(parseCitation('1 John 3:16-18, NIV')).toEqual({
			translation: 'NIV',
			book: '1 John',
			chapter: 3,
			verseStart: 16,
			verseEnd: 18,
		});
	});

	it('returns null without a chapter:verse', () => {
		expect(parseCitation('a greeting')).toBeNull();
	});

	it('does not treat a second reference or a bare number as a translation', () => {
		expect(parseCitation('1 Timothy 3:1, Titus 1:5')?.translation).toBe('');
		expect(parseCitation('Romans 8:1, 8')?.translation).toBe('');
	});
});

describe('countVerses', () => {
	it('counts an inclusive range', () => {
		expect(
			countVerses({
				translation: '',
				book: 'John',
				chapter: 3,
				verseStart: 16,
				verseEnd: 18,
			}),
		).toBe(3);
	});
});

describe('summarizeScripture', () => {
	it('aggregates verses per translation', () => {
		const citations: Citation[] = [
			{
				translation: 'ESV',
				book: 'John',
				chapter: 6,
				verseStart: 47,
				verseEnd: 47,
			},
			{
				translation: 'ESV',
				book: 'John',
				chapter: 3,
				verseStart: 16,
				verseEnd: 17,
			},
			{
				translation: 'NIV',
				book: 'Psalm',
				chapter: 23,
				verseStart: 1,
				verseEnd: 1,
			},
		];
		const usage = summarizeScripture(citations);
		expect(usage.totalVerses).toBe(4);
		expect(usage.byTranslation.ESV?.verses).toBe(3);
		expect(usage.byTranslation.NIV?.verses).toBe(1);
		expect(usage.byTranslation.ESV?.references).toEqual([
			'John 6:47',
			'John 3:16-17',
		]);
	});
});
