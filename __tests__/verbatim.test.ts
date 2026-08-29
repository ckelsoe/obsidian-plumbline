import { parseChapter, verseMatches } from '../engine/verbatim';

const chapter = [
	'---',
	'translation: X',
	'book: John',
	'chapter: 3',
	'---',
	'',
	'# John 3',
	'',
	'For God so loved the world, that he gave his only Son. ^v16',
	'',
	'That whoever believes in him should not perish. ^v17',
].join('\n');

describe('parseChapter', () => {
	it('extracts verse text by number, without the preamble', () => {
		const verses = parseChapter(chapter);
		expect(verses.get(16)).toBe(
			'For God so loved the world, that he gave his only Son.',
		);
		expect(verses.get(17)).toBe(
			'That whoever believes in him should not perish.',
		);
	});
});

describe('verseMatches', () => {
	const verse = 'For God so loved the world, that he gave his only Son.';

	it('matches a full quote', () => {
		expect(verseMatches(verse, verse)).toBe(true);
	});

	it('matches a partial quote split on an ellipsis', () => {
		expect(
			verseMatches('For God so loved the world...his only Son.', verse),
		).toBe(true);
	});

	it('ignores surrounding quotes and case', () => {
		expect(verseMatches('"FOR GOD SO LOVED THE WORLD"', verse)).toBe(true);
	});

	it('flags a misquote', () => {
		expect(verseMatches('For God so hated the world', verse)).toBe(false);
	});
});
