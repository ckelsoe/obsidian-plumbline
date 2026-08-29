import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Diagnostic, LintResult } from './engine/types';
import type PlumblinePlugin from './main';

export const FINDINGS_VIEW_TYPE = 'plumbline-findings';

// A side panel that lists every flag in the active note. It is a dumb renderer:
// the plugin computes the analysis and pushes it here with update(), so clicking
// into the panel never re-triggers analysis against the panel itself.
export class FindingsView extends ItemView {
	private readonly plugin: PlumblinePlugin;
	private result: LintResult | null = null;
	private targetView: MarkdownView | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: PlumblinePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return FINDINGS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Plumbline flags';
	}

	getIcon(): string {
		return 'flag';
	}

	onOpen(): Promise<void> {
		// Pull the latest analysis so a freshly opened panel is populated at once.
		this.plugin.populateFindings(this);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		return Promise.resolve();
	}

	// Called by the plugin when the active note's analysis changes.
	update(result: LintResult, targetView: MarkdownView): void {
		this.result = result;
		this.targetView = targetView;
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('plumbline-findings');
		if (!this.result || !this.targetView) {
			container.createEl('p', {
				cls: 'plumbline-findings-empty',
				text: 'Open a note to see its flags.',
			});
			return;
		}
		if (this.result.diagnostics.length === 0) {
			container.createEl('p', {
				cls: 'plumbline-findings-empty',
				text: 'No flags in this note.',
			});
			return;
		}
		const docText = this.targetView.editor.getValue();
		const list = container.createDiv({ cls: 'plumbline-findings-list' });
		for (const diagnostic of this.result.diagnostics) {
			this.renderRow(list, diagnostic, docText);
		}
	}

	private renderRow(
		list: HTMLElement,
		diagnostic: Diagnostic,
		docText: string,
	): void {
		const targetView = this.targetView;
		if (!targetView) {
			return;
		}
		const pos = targetView.editor.offsetToPos(diagnostic.start);
		const row = list.createDiv({ cls: 'plumbline-finding' });
		const head = row.createDiv({ cls: 'plumbline-finding-head' });
		head.createSpan({
			cls: 'plumbline-finding-text',
			text: docText.slice(diagnostic.start, diagnostic.end),
		});
		head.createSpan({
			cls: 'plumbline-finding-line',
			text: `L${pos.line + 1}`,
		});
		row.createDiv({
			cls: 'plumbline-finding-msg',
			text: diagnostic.message,
		});
		row.addEventListener('click', () => {
			this.jumpTo(diagnostic);
		});
	}

	private jumpTo(diagnostic: Diagnostic): void {
		const targetView = this.targetView;
		if (!targetView) {
			return;
		}
		const editor = targetView.editor;
		const from = editor.offsetToPos(diagnostic.start);
		const to = editor.offsetToPos(diagnostic.end);
		void this.plugin.app.workspace.revealLeaf(targetView.leaf);
		editor.focus();
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
	}
}
