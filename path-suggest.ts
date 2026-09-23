import {
	AbstractInputSuggest,
	App,
	TAbstractFile,
	TFile,
	TFolder,
} from 'obsidian';

// Suggests vault folders, or Markdown notes, under a text input, for settings
// that take a path in an imperative SettingPage (the declarative `folder` and
// `file` controls are not available there). Picking a suggestion fills the
// input and reports the choice.
export class PathSuggest extends AbstractInputSuggest<TAbstractFile> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly kind: 'folder' | 'note',
		private readonly onPick: (path: string) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TAbstractFile[] {
		const needle = query.toLowerCase();
		const candidates: TAbstractFile[] =
			this.kind === 'folder'
				? this.app.vault.getAllFolders(false)
				: this.app.vault.getMarkdownFiles();
		return candidates
			.filter((item) => item.path.toLowerCase().includes(needle))
			.slice(0, 50);
	}

	renderSuggestion(item: TAbstractFile, el: HTMLElement): void {
		el.setText(item.path);
	}

	selectSuggestion(item: TAbstractFile): void {
		if (!(item instanceof TFolder || item instanceof TFile)) {
			return;
		}
		this.input.value = item.path;
		this.onPick(item.path);
		this.close();
	}
}
