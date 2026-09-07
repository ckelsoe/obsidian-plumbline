import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Finding, LintResult, Occurrence } from './engine/types';
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
		if (this.result.findings.length === 0) {
			container.createEl('p', {
				cls: 'plumbline-findings-empty',
				text: 'No flags in this note.',
			});
			return;
		}
		// One row per RULE, in priority order, rather than one per hit in
		// document order. A chapter that fires the same rule fifteen times is one
		// row saying so. The engine did the grouping and ranking (PL-B), so the
		// panel, the report and the CLI cannot disagree about the count.
		//
		// Paragraph grouping, the severity floor and the row cap are PL-C.
		const docText = this.targetView.editor.getValue();
		const list = container.createDiv({ cls: 'plumbline-findings-list' });
		for (const finding of this.result.findings) {
			this.renderRow(list, finding, docText);
		}
	}

	private renderRow(
		list: HTMLElement,
		finding: Finding,
		docText: string,
	): void {
		const targetView = this.targetView;
		if (!targetView) {
			return;
		}
		const first = finding.occurrences[0];
		if (first === undefined) {
			return;
		}
		const count = finding.occurrences.length;
		const pos = targetView.editor.offsetToPos(first.start);
		const row = list.createDiv({ cls: 'plumbline-finding' });
		const head = row.createDiv({ cls: 'plumbline-finding-head' });
		head.createSpan({
			cls: 'plumbline-finding-text',
			text: docText.slice(first.start, first.end),
		});
		// The count is what makes a grouped row readable: without it a rule that
		// fired fifteen times looks the same as one that fired once.
		if (count > 1) {
			head.createSpan({
				cls: 'plumbline-finding-count',
				text: `x${count}`,
			});
		}
		head.createSpan({
			cls: 'plumbline-finding-line',
			text: `L${pos.line + 1}`,
		});
		row.createDiv({
			cls: 'plumbline-finding-msg',
			text: finding.message,
		});
		// Clicking a grouped row goes to the FIRST occurrence. Expanding to the
		// rest is PL-C; jumping somewhere is better than jumping nowhere.
		row.addEventListener('click', () => {
			this.jumpTo(first);
		});
	}

	private jumpTo(occurrence: Occurrence): void {
		const targetView = this.targetView;
		if (!targetView) {
			return;
		}
		const editor = targetView.editor;
		const from = editor.offsetToPos(occurrence.start);
		const to = editor.offsetToPos(occurrence.end);
		void this.plugin.app.workspace.revealLeaf(targetView.leaf);
		editor.focus();
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
	}
}
