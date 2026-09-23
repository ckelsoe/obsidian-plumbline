import { normalizePath, TFile, TFolder } from 'obsidian';
import { Citation } from './engine/citation';
import {
	chapterFileName,
	matchBookFolder,
	matchTranslationFolder,
} from './engine/corpus-layout';
import { parseChapter } from './engine/verbatim';
import type PlumblinePlugin from './main';

// Looks up verse text in the scripture folder chosen in settings (layout in
// engine/corpus-layout.ts). Best-effort: any miss (unknown translation, book,
// chapter, or verse) returns null, so the verbatim check skips what it cannot
// verify rather than flagging it. Folder and file names are only ever matched
// against real children of the scripture folder, so a citation cannot name a
// path outside it.

function childFolders(folder: TFolder): TFolder[] {
	return folder.children.filter(
		(child): child is TFolder => child instanceof TFolder,
	);
}

export class CorpusService {
	constructor(private readonly plugin: PlumblinePlugin) {}

	// The scripture folder as a vault folder, or null when the setting is empty
	// or names a folder that does not exist.
	rootFolder(): TFolder | null {
		const setting = this.plugin.settings.scriptureFolder.trim();
		if (setting.length === 0) {
			return null;
		}
		return this.plugin.app.vault.getFolderByPath(normalizePath(setting));
	}

	async verseText(citation: Citation): Promise<string | null> {
		try {
			const root = this.rootFolder();
			if (!root) {
				return null;
			}
			const translations = childFolders(root);
			const translationName = matchTranslationFolder(
				translations.map((folder) => folder.name),
				citation.translation,
			);
			const translation = translations.find(
				(folder) => folder.name === translationName,
			);
			if (!translation) {
				return null;
			}
			const books = childFolders(translation);
			const bookName = matchBookFolder(
				books.map((folder) => folder.name),
				citation.book,
			);
			const book = books.find((folder) => folder.name === bookName);
			if (!book) {
				return null;
			}
			const fileName = chapterFileName(book.name, citation.chapter);
			const file = book.children.find(
				(child): child is TFile =>
					child instanceof TFile && child.name === fileName,
			);
			if (!file) {
				return null;
			}
			const verses = parseChapter(
				await this.plugin.app.vault.cachedRead(file),
			);
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
}
