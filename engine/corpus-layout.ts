// Pure layout rules for the scripture corpus the verbatim check reads. The corpus
// is a folder the user picks in settings, laid out as
//
//   <scripture folder>/<translation>/<prefix> - <Book>/<Book> <chapter>.md
//
// e.g. Bible/KJV/19 - Psalms/Psalms 23.md, with each verse a paragraph ending in
// a `^vN` block marker. The file reads stay plugin-side; this module only decides
// which folder and file names match, so it is unit-tested without a vault.

// A translation code is safe to match against folder names when it is plain
// alphanumerics. This keeps a malformed citation (e.g. "../secrets") from ever
// naming anything outside the scripture folder.
export function isSafeCode(code: string): boolean {
	if (code.length === 0) {
		return false;
	}
	for (const char of code.toLowerCase()) {
		const alpha = char >= 'a' && char <= 'z';
		const digit = char >= '0' && char <= '9';
		if (!alpha && !digit) {
			return false;
		}
	}
	return true;
}

// The translation folder for a citation's code, matched case-insensitively so
// "KJV", "kjv", and "Kjv" folders all work. Null when none matches.
export function matchTranslationFolder(
	folderNames: readonly string[],
	code: string,
): string | null {
	if (!isSafeCode(code)) {
		return null;
	}
	const wanted = code.toLowerCase();
	return folderNames.find((name) => name.toLowerCase() === wanted) ?? null;
}

// The book name a book folder carries: the text after the first " - ", so
// "19 - Psalms" is "Psalms". Null for a folder that does not follow the layout.
export function bookNameOf(folderName: string): string | null {
	const dash = folderName.indexOf(' - ');
	if (dash === -1) {
		return null;
	}
	const name = folderName.slice(dash + 3).trim();
	return name.length > 0 ? name : null;
}

// The book folder for a cited book, matched case-insensitively and tolerating a
// singular citation of a plural book name ("Psalm 23" finds "19 - Psalms").
export function matchBookFolder(
	folderNames: readonly string[],
	book: string,
): string | null {
	const key = book.toLowerCase();
	let plural: string | null = null;
	for (const folder of folderNames) {
		const name = bookNameOf(folder)?.toLowerCase();
		if (name === key) {
			return folder;
		}
		if (plural === null && name === `${key}s`) {
			plural = folder;
		}
	}
	return plural;
}

// The chapter file name inside a book folder: "<Book> <chapter>.md".
export function chapterFileName(bookFolder: string, chapter: number): string {
	return `${bookNameOf(bookFolder) ?? bookFolder} ${chapter}.md`;
}
