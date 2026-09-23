import {
	bookNameOf,
	chapterFileName,
	isSafeCode,
	matchBookFolder,
	matchTranslationFolder,
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
