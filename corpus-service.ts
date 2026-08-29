import { Citation } from './engine/citation';
import { parseChapter } from './engine/verbatim';
import type PlumblinePlugin from './main';

// Looks up verse text in the vault's Bible corpus (10-bibles/<code>/<NN - Book>/
// <Book Chapter>.md, verses tagged ^vN). Best-effort: any miss (unknown
// translation, book, chapter, or verse) returns null, so the verbatim check
// skips what it cannot verify rather than flagging it.
// A translation code is safe to put in a path when it is plain alphanumerics.
// This blocks a malformed citation (e.g. "../secrets") from escaping 10-bibles.
function isSafeCode(code: string): boolean {
	if (code.length === 0) {
		return false;
	}
	for (const char of code) {
		const alpha = char >= 'a' && char <= 'z';
		const digit = char >= '0' && char <= '9';
		if (!alpha && !digit) {
			return false;
		}
	}
	return true;
}

export class CorpusService {
	private readonly folderCache = new Map<string, Map<string, string>>();

	constructor(private readonly plugin: PlumblinePlugin) {}

	async verseText(citation: Citation): Promise<string | null> {
		try {
			const code = citation.translation.toLowerCase();
			if (!isSafeCode(code)) {
				return null;
			}
			const folder = await this.bookFolder(code, citation.book);
			if (!folder) {
				return null;
			}
			const bookName = folder.slice(folder.indexOf(' - ') + 3);
			const path = `10-bibles/${code}/${folder}/${bookName} ${citation.chapter}.md`;
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(path))) {
				return null;
			}
			const verses = parseChapter(await adapter.read(path));
			// Cap the range so a malformed citation cannot spin a huge loop.
			const end = Math.min(citation.verseEnd, citation.verseStart + 200);
			const parts: string[] = [];
			for (let v = citation.verseStart; v <= end; v++) {
				const text = verses.get(v);
				if (text !== undefined) {
					parts.push(text);
				}
			}
			return parts.length > 0 ? parts.join(' ') : null;
		} catch (err) {
			console.error(err);
			return null;
		}
	}

	// Map a book name to its corpus folder ("Psalm" -> "19 - Psalms"), listing the
	// translation folder once and caching. Handles a trailing-s plural.
	private async bookFolder(
		code: string,
		book: string,
	): Promise<string | null> {
		let map = this.folderCache.get(code);
		if (!map) {
			map = new Map<string, string>();
			try {
				const listing = await this.plugin.app.vault.adapter.list(
					`10-bibles/${code}`,
				);
				for (const folderPath of listing.folders) {
					const name = folderPath.split('/').pop() ?? '';
					const dash = name.indexOf(' - ');
					if (dash !== -1) {
						map.set(name.slice(dash + 3).toLowerCase(), name);
					}
				}
			} catch (err) {
				console.error(err);
			}
			this.folderCache.set(code, map);
		}
		const key = book.toLowerCase();
		return map.get(key) ?? map.get(`${key}s`) ?? null;
	}
}
