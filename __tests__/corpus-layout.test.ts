import {
	bookNameOf,
	chapterFileName,
	isSafeCode,
	matchBookFolder,
	matchTranslationFolder,
	checkQuoteSourceLayout,
	isChapterFileName,
} from '../engine/corpus-layout';

describe('isSafeCode', () => {
	it('accepts plain alphanumeric codes in either case', () => {
		expect(isSafeCode('kjv')).toBe(true);
		expect(isSafeCode('NASB95')).toBe(true);
	});

	it('rejects empty, path-like, and punctuated codes', () => {
		expect(isSafeCode('')).toBe(false);
		expect(isSafeCode('../secrets')).toBe(false);
		expect(isSafeCode('kjv/..')).toBe(false);
		expect(isSafeCode('esv ')).toBe(false);
	});
});

describe('matchTranslationFolder', () => {
	const folders = ['KJV', 'esv', 'Notes'];

	it('matches the citation code case-insensitively and returns the real name', () => {
		expect(matchTranslationFolder(folders, 'kjv')).toBe('KJV');
		expect(matchTranslationFolder(folders, 'ESV')).toBe('esv');
	});

	it('returns null for an unknown or unsafe code', () => {
		expect(matchTranslationFolder(folders, 'niv')).toBeNull();
		expect(matchTranslationFolder(['..'], '..')).toBeNull();
	});
});

describe('bookNameOf', () => {
	it('takes the text after the first " - "', () => {
		expect(bookNameOf('19 - Psalms')).toBe('Psalms');
		expect(bookNameOf('01 - 1 Samuel')).toBe('1 Samuel');
	});

	it('returns null for a folder outside the layout', () => {
		expect(bookNameOf('Psalms')).toBeNull();
		expect(bookNameOf('19 - ')).toBeNull();
	});
});

describe('matchBookFolder', () => {
	const folders = ['01 - Genesis', '19 - Psalms', '40 - Matthew', 'Extras'];

	it('matches a book name case-insensitively', () => {
		expect(matchBookFolder(folders, 'genesis')).toBe('01 - Genesis');
		expect(matchBookFolder(folders, 'Matthew')).toBe('40 - Matthew');
	});

	it('finds a plural book from a singular citation', () => {
		expect(matchBookFolder(folders, 'Psalm')).toBe('19 - Psalms');
	});

	it('prefers an exact name over a plural one', () => {
		expect(matchBookFolder(['02 - Actss', '01 - Acts'], 'Acts')).toBe(
			'01 - Acts',
		);
	});

	it('returns null when no book matches', () => {
		expect(matchBookFolder(folders, 'Exodus')).toBeNull();
	});
});

describe('chapterFileName', () => {
	it('names the chapter note after the book folder', () => {
		expect(chapterFileName('19 - Psalms', 23)).toBe('Psalms 23.md');
		expect(chapterFileName('09 - 1 Samuel', 3)).toBe('1 Samuel 3.md');
	});
});

describe('checkQuoteSourceLayout', () => {
	const psalms = {
		name: '19 - Psalms',
		files: ['Psalms 23.md', 'Psalms 1.md'],
	};

	it('summarises a valid layout and names a chapter to sample', () => {
		const result = checkQuoteSourceLayout([
			{
				name: 'KJV',
				books: [
					psalms,
					{ name: '01 - Genesis', files: ['Genesis 1.md'] },
				],
			},
			{ name: 'ESV', books: [psalms] },
		]);
		expect(result.ok).toBe(true);
		expect(result.message).toBe('2 translations, 3 books, 5 chapters.');
		expect(result.sample).toEqual({
			translation: 'KJV',
			book: '19 - Psalms',
			file: 'Psalms 23.md',
		});
	});

	it('names a translation folder with no usable books', () => {
		const result = checkQuoteSourceLayout([
			{ name: 'KJV', books: [psalms] },
			{
				name: 'NIV',
				books: [{ name: 'Psalms', files: ['Psalms 23.md'] }],
			},
		]);
		expect(result.ok).toBe(true);
		expect(result.message).toBe(
			'1 translation, 1 book, 2 chapters. No usable books in: NIV.',
		);
	});

	it('reports a folder with no translation folders', () => {
		const result = checkQuoteSourceLayout([
			{ name: 'my notes', books: [] },
		]);
		expect(result.ok).toBe(false);
		expect(result.message).toContain('No translation folders found');
	});

	it('reports translations whose books do not follow the layout', () => {
		const result = checkQuoteSourceLayout([
			{ name: 'KJV', books: [{ name: '19 - Psalms', files: ['23.md'] }] },
		]);
		expect(result.ok).toBe(false);
		expect(result.message).toContain('in KJV');
	});
});

describe('isChapterFileName', () => {
	it('accepts "<Book> <number>.md"', () => {
		expect(isChapterFileName('Psalms 23.md', 'Psalms')).toBe(true);
		expect(isChapterFileName('1 Samuel 3.md', '1 Samuel')).toBe(true);
	});

	it('rejects names the lookup would never ask for', () => {
		expect(isChapterFileName('Psalms notes.md', 'Psalms')).toBe(false);
		expect(isChapterFileName('Psalms 23 draft.md', 'Psalms')).toBe(false);
		expect(isChapterFileName('Psalms 023.md', 'Psalms')).toBe(false);
		expect(isChapterFileName('Psalms .md', 'Psalms')).toBe(false);
		expect(isChapterFileName('Psalms 23.txt', 'Psalms')).toBe(false);
	});

	it('does not count look-alike files toward a valid layout', () => {
		const result = checkQuoteSourceLayout([
			{
				name: 'KJV',
				books: [{ name: '19 - Psalms', files: ['Psalms notes.md'] }],
			},
		]);
		expect(result.ok).toBe(false);
	});
});
