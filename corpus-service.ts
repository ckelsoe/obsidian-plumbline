import { TFile, TFolder } from 'obsidian';
import { Citation } from './engine/citation';
import {
	chapterFileName,
	matchBookFolder,
	matchTranslationFolder,
} from './engine/corpus-layout';
import { parseChapter } from './engine/verbatim';
import type PlumblinePlugin from './main';

// Looks up verse text in a quote-source reference's folder (layout in
// engine/corpus-layout.ts). Best-effort: any miss (unknown translation, book,
// chapter, or verse) returns null, so the verbatim check skips what it cannot
// verify rather than flagging it. Folder and file names are only ever matched
// against real children of the reference folder, so a citation cannot name a
// path outside it.

function childFolders(folder: TFolder): TFolder[] {
	return folder.children.filter(
		(child): child is TFolder => child instanceof TFolder,
	);
}

export class CorpusService {
	constructor(private readonly plugin: PlumblinePlugin) {}

	async verseText(root: TFolder, citation: Citation): Promise<string | null> {
		try {
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
