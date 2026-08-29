// Pure logic for the verbatim-diff rule (ruleset rule 26): parse a corpus
// chapter file into verse text, and check a quoted verse against it. The corpus
// lookup itself (reading vault files) is plugin-side; this stays pure and tested.

// Normalize for comparison: unify quote glyphs, collapse whitespace, lowercase.
// Verbatim in spirit, but tolerant of quote-style and case differences that are
// not real misquotes, so the check flags word-content changes rather than noise.
export function normalize(text: string): string {
	return text
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function isQuoteChar(char: string | undefined): boolean {
	return char === '"' || char === "'" || char === '“' || char === '”';
}

function stripEdgeQuotes(text: string): string {
	let start = 0;
	let end = text.length;
	while (start < end && isQuoteChar(text[start])) {
		start++;
	}
	while (end > start && isQuoteChar(text[end - 1])) {
		end--;
	}
	return text.slice(start, end);
}

// Strip leading YAML frontmatter and the `# Book Chapter` heading so verse 1's
// text does not carry the preamble.
function stripPreamble(content: string): string {
	let body = content;
	if (body.startsWith('---')) {
		const end = body.indexOf('\n---', 3);
		if (end !== -1) {
			body = body.slice(end + 4);
		}
	}
	return body.replace(/^\s*#[^\n]*\n?/, '');
}

// Parse a corpus chapter (verses are paragraphs ending in a `^vN` block marker)
// into a map of verse number to verse text.
export function parseChapter(content: string): Map<number, string> {
	const verses = new Map<number, string>();
	const body = stripPreamble(content);
	const marker = /\^v(\d+)/g;
	let lastEnd = 0;
	for (let m = marker.exec(body); m !== null; m = marker.exec(body)) {
		const verse = Number.parseInt(m[1] ?? '', 10);
		if (Number.isFinite(verse)) {
			verses.set(verse, body.slice(lastEnd, m.index).trim());
		}
		lastEnd = marker.lastIndex;
	}
	return verses;
}

// Does the quoted text match the corpus verse(s)? A quote may be partial, split
// on an ellipsis; every fragment must appear in the reference text. A fragment
// that is absent means the quote does not match the corpus.
export function verseMatches(quote: string, corpusVerse: string): boolean {
	const reference = normalize(corpusVerse);
	const fragments = quote
		.split(/\.\.\.|…/)
		.map((fragment) => normalize(stripEdgeQuotes(fragment)))
		.filter((fragment) => fragment.length > 0);
	if (fragments.length === 0) {
		return true;
	}
	return fragments.every((fragment) => reference.includes(fragment));
}
