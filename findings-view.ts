import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { LintResult, Occurrence } from './engine/types';
import {
	DEFAULT_ROW_CAP,
	buildPanelModel,
	sectionSummary,
	type PanelRow,
	type PanelSection,
} from './panel-model';
import type PlumblinePlugin from './main';

export const FINDINGS_VIEW_TYPE = 'plumbline-findings';

// A side panel that lists every flag in the active note. It is a dumb renderer:
// the plugin computes the analysis and pushes it here with update(), so clicking
// into the panel never re-triggers analysis against the panel itself.
export class FindingsView extends ItemView {
	private readonly plugin: PlumblinePlugin;
	private result: LintResult | null = null;
	private targetView: MarkdownView | null = null;
	// Which grouped rows and collapsed groups the reader has opened. Kept across
	// re-renders, because a re-lint while something is expanded should not close
	// it under them.
	private readonly expanded = new Set<string>();
	private showAll = false;
	private targetPath: string | undefined;

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
		// Per NOTE, not per view. "Show more" and every expanded row are answers
		// about the note the reader was looking at. Carrying them to the next note
		// disables the row cap for the rest of the session, and leaves expansion
		// keys pointing at offsets in a different document. Re-lints of the SAME
		// note keep them, which is the case that matters: a list must not collapse
		// under the reader because they typed.
		const path = targetView.file?.path;
		if (path !== this.targetPath) {
			this.targetPath = path;
			this.showAll = false;
			this.expanded.clear();
		}
		this.result = result;
		this.targetView = targetView;
		this.render();
	}

	// Every toggle in this panel re-renders the whole list, which empties
	// contentEl and throws away the element the reader was standing on. For a
	// mouse that is invisible; for a keyboard it drops focus to the document and
	// the next Tab starts from the top, so expanding one group costs the reader
	// their place. Focus is keyed on a stable id rather than a DOM reference,
	// because the element itself does not survive the repaint.
	private focusKey: string | undefined;

	private restoreFocus(): void {
		if (this.focusKey === undefined) return;
		const el = this.contentEl.querySelector(
			`[data-plumbline-focus="${CSS.escape(this.focusKey)}"]`,
		);
		if (el instanceof HTMLElement) el.focus();
	}

	// Re-render, then put the reader back where they were.
	private rerender(focusKey: string): void {
		this.focusKey = focusKey;
		this.render();
		this.restoreFocus();
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
		const docText = this.targetView.editor.getValue();
		const model = buildPanelModel(
			docText,
			this.result.findings,
			this.showAll ? Number.MAX_SAFE_INTEGER : DEFAULT_ROW_CAP,
		);
		if (model.sections.length === 0) {
			container.createEl('p', {
				cls: 'plumbline-findings-empty',
				text: 'No flags in this note.',
			});
			return;
		}

		const list = container.createDiv({ cls: 'plumbline-findings-list' });
		for (const section of model.sections) {
			this.renderSection(list, section, docText);
		}

		// Never a silent truncation. The count is what tells a reader the list is
		// partial, and the cap exists so a pathological note does not freeze the
		// view, not to decide what they may see.
		if (model.hidden > 0) {
			const more = container.createEl('button', {
				cls: 'plumbline-findings-more',
				text: `Show ${model.hidden} more`,
				attr: { type: 'button' },
			});
			more.setAttribute('data-plumbline-focus', 'show-all');
			more.addEventListener('click', () => {
				this.showAll = true;
				// No focus key: the button it would restore to is gone, since
				// showing everything is what removes it. Focus falls to the
				// document, which is correct here rather than a regression.
				this.focusKey = undefined;
				this.render();
			});
		}
	}

	private renderSection(
		list: HTMLElement,
		section: PanelSection,
		docText: string,
	): void {
		const wrap = list.createDiv({ cls: 'plumbline-section' });
		// A real button, not a clickable div. It navigates, so it has to be
		// reachable and activatable from the keyboard, and its accessible name has
		// to carry what the two spans below say visually.
		const summary = sectionSummary(section);
		const head = wrap.createEl('button', {
			cls: 'plumbline-section-head',
			attr: {
				type: 'button',
				'aria-label': `Paragraph ${section.paragraph}: ${summary}`,
			},
		});
		head.createSpan({
			cls: 'plumbline-section-name',
			text: `Paragraph ${section.paragraph}`,
		});
		head.createSpan({
			cls: 'plumbline-section-summary',
			text: summary,
		});
		// Jumps to the paragraph, so a reader can go straight to the prose the
		// summary is about without picking a row first.
		head.addEventListener('click', () => {
			this.jumpTo({ start: section.start, end: section.start });
		});

		for (const row of section.rows) {
			this.renderRow(wrap, row, docText);
		}

		if (section.collapsed.count > 0) {
			const key = `${section.paragraph}`;
			const open = this.expanded.has(key);
			// Occurrences, matching the section header. Counting rules here put
			// "1 suggestion" under a header reading "5 suggestions".
			const n = section.collapsed.count;
			const focusKey = `collapsed:${key}`;
			const toggle = wrap.createEl('button', {
				cls: 'plumbline-collapsed',
				text: open
					? `Hide ${n} suggestion${n === 1 ? '' : 's'}`
					: `${n} suggestion${n === 1 ? '' : 's'}`,
				attr: { type: 'button', 'data-plumbline-focus': focusKey },
			});
			toggle.addEventListener('click', () => {
				if (open) {
					this.expanded.delete(key);
				} else {
					this.expanded.add(key);
				}
				this.rerender(focusKey);
			});
			if (open) {
				for (const row of section.collapsed.rows) {
					this.renderRow(wrap, row, docText);
				}
			}
		}
	}

	private renderRow(
		wrap: HTMLElement,
		panelRow: PanelRow,
		docText: string,
	): void {
		const targetView = this.targetView;
		if (!targetView) {
			return;
		}
		const first = panelRow.occurrences[0];
		if (first === undefined) {
			return;
		}
		const count = panelRow.occurrences.length;
		const key = `${panelRow.ruleSlug}:${first.start}`;
		const open = this.expanded.has(key);

		const row = wrap.createDiv({
			cls: `plumbline-finding plumbline-finding-${panelRow.severity}`,
		});
		const head = row.createDiv({ cls: 'plumbline-finding-head' });
		head.createSpan({
			cls: 'plumbline-finding-text',
			text: docText.slice(first.start, first.end),
		});
		if (count > 1) {
			head.createSpan({
				cls: 'plumbline-finding-count',
				text: `x${count}`,
			});
		}
		head.createSpan({
			cls: 'plumbline-finding-line',
			text: `L${targetView.editor.offsetToPos(first.start).line + 1}`,
		});
		row.createDiv({
			cls: 'plumbline-finding-msg',
			text: panelRow.message,
		});

		// A row standing for several hits expands to them rather than only ever
		// jumping to the first, which is what "x12" would otherwise hide.
		if (count > 1) {
			row.setAttribute('data-plumbline-focus', `row:${key}`);
			row.addEventListener('click', () => {
				if (open) {
					this.expanded.delete(key);
				} else {
					this.expanded.add(key);
				}
				this.rerender(`row:${key}`);
			});
			if (open) {
				const occ = row.createDiv({ cls: 'plumbline-occurrences' });
				for (const [i, o] of panelRow.occurrences.entries()) {
					const text = docText.slice(o.start, o.end);
					// Buttons, not clickable divs. Stepping through the places a
					// rule fired is the reason a grouped row expands at all, and
					// a keyboard user has to be able to do it.
					const item = occ.createEl('button', {
						cls: 'plumbline-occurrence',
						text: `${i + 1}. ${text}`,
						attr: {
							type: 'button',
							'aria-label': `Occurrence ${i + 1} of ${panelRow.occurrences.length}: ${text}`,
						},
					});
					item.addEventListener('click', (e) => {
						e.stopPropagation();
						this.jumpTo(o);
					});
				}
			}
		} else {
			row.addEventListener('click', () => {
				this.jumpTo(first);
			});
		}
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
