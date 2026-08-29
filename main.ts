import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { PlumblineSettingTab } from './settings-tab';
import { AnalysisService } from './analysis-service';
import { rhythmStatusText, rhythmDetail } from './rhythm-format';
import { plumblineDecorations } from './editor-decorations';
import { FindingsView, FINDINGS_VIEW_TYPE } from './findings-view';
import { LintResult, ResolvedConfig } from './engine/types';
import { buildReport } from './report';
import { scriptureReferences, scriptureQuotes } from './engine/scripture';
import { summarizeScripture, Citation } from './engine/citation';
import { verseMatches } from './engine/verbatim';
import { summarizeCaps } from './engine/verse-caps';
import { CorpusService } from './corpus-service';
import { resolveConfig } from './engine/config';
import {
	VaultConfig,
	EMPTY_VAULT_CONFIG,
	parseVaultConfig,
} from './engine/vault-config';

export interface PlumblineSettings {
	// The active profile selects which rule packs are on and how they are tuned.
	// Profiles and the pack cascade are specified in the project's dev docs.
	activeProfile: string;
}

export const DEFAULT_SETTINGS: PlumblineSettings = {
	activeProfile: 'scripture-book',
};

// Debounce for live re-analysis while typing, in milliseconds.
const REFRESH_DELAY = 400;

export default class PlumblinePlugin extends Plugin {
	// A fresh copy, so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PlumblineSettings = { ...DEFAULT_SETTINGS };

	private readonly analysis = new AnalysisService(this);
	private readonly corpus = new CorpusService(this);
	private statusBar: HTMLElement | null = null;
	private refreshTimer: number | null = null;
	// The most recent markdown analysis, so a panel opened later can populate at
	// once and keeps showing while a non-editor pane (like the panel) is focused.
	private lastResult: LintResult | null = null;
	private lastView: MarkdownView | null = null;
	private vaultConfig: VaultConfig = EMPTY_VAULT_CONFIG;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadVaultConfig();
		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new PlumblineSettingTab(this.app, this));

		// Underline flagged phrases in the editor, live.
		this.registerEditorExtension(
			plumblineDecorations(() => this.resolvedConfig()),
		);

		this.registerView(
			FINDINGS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new FindingsView(leaf, this),
		);
		this.addRibbonIcon('flag', 'Plumbline flags', () => {
			void this.activateFindingsView();
		});
		this.addCommand({
			id: 'open-flags-panel',
			name: 'Open the flags panel',
			callback: () => {
				void this.activateFindingsView();
			},
		});

		// Switching notes recomputes at once; typing recomputes debounced.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refresh();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.scheduleRefresh();
			}),
		);

		this.addCommand({
			id: 'show-prose-rhythm',
			name: 'Show prose rhythm for the active note',
			callback: () => {
				this.showRhythmNotice();
			},
		});
		this.addCommand({
			id: 'write-flags-report',
			name: 'Write a flags report for the active note',
			callback: () => {
				void this.writeReport();
			},
		});
		this.addCommand({
			id: 'reload-config',
			name: 'Reload the config from the vault',
			callback: () => {
				void this.reloadVaultConfig();
			},
		});
		this.addCommand({
			id: 'show-scripture-usage',
			name: 'Show scripture usage for the active note',
			callback: () => {
				this.showScriptureUsage();
			},
		});
		this.addCommand({
			id: 'check-quoted-scripture',
			name: 'Check quoted scripture for the active note',
			callback: () => {
				void this.checkScripture();
			},
		});
		this.addCommand({
			id: 'check-verse-caps',
			name: 'Check verse caps across the vault',
			callback: () => {
				void this.checkVerseCaps();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			this.refresh();
		});
	}

	onunload(): void {
		this.clearRefreshTimer();
	}

	async loadSettings(): Promise<void> {
		// loadData() is untyped JSON from disk and may be missing, malformed, or
		// hand-edited. Validate each field's type before trusting it, and fall back
		// to the default rather than storing a bad value.
		const stored = (await this.loadData()) as unknown;
		const record =
			typeof stored === 'object' && stored !== null
				? (stored as Record<string, unknown>)
				: {};
		this.settings = {
			activeProfile:
				typeof record.activeProfile === 'string'
					? record.activeProfile
					: DEFAULT_SETTINGS.activeProfile,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Push the most recent analysis into a panel (called by the panel on open).
	populateFindings(panel: FindingsView): void {
		if (this.lastResult && this.lastView) {
			panel.update(this.lastResult, this.lastView);
		}
	}

	// The resolved config for the active profile, with vault overrides applied.
	resolvedConfig(): ResolvedConfig {
		return resolveConfig(this.settings.activeProfile, this.vaultConfig);
	}

	private async loadVaultConfig(): Promise<void> {
		try {
			const path = '.plumbline/config.json';
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(path))) {
				this.vaultConfig = EMPTY_VAULT_CONFIG;
				return;
			}
			this.vaultConfig = parseVaultConfig(
				JSON.parse(await adapter.read(path)) as unknown,
			);
		} catch (err) {
			console.error(err);
			this.vaultConfig = EMPTY_VAULT_CONFIG;
		}
	}

	private async reloadVaultConfig(): Promise<void> {
		await this.loadVaultConfig();
		this.refresh();
		new Notice('Plumbline: reloaded config.');
	}

	private async activateFindingsView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(FINDINGS_VIEW_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: FINDINGS_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	private scheduleRefresh(): void {
		this.clearRefreshTimer();
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, REFRESH_DELAY);
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	// Recompute the active note's analysis and push it to the status bar and any
	// open findings panel. When a non-markdown pane is focused, the last analysis
	// stays on screen rather than clearing.
	private refresh(): void {
		const view = this.analysis.activeMarkdownView();
		if (!view) {
			return;
		}
		const result = this.analysis.analyze(view);
		this.lastResult = result;
		this.lastView = view;
		if (this.statusBar) {
			this.statusBar.setText(rhythmStatusText(result));
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			FINDINGS_VIEW_TYPE,
		)) {
			if (leaf.view instanceof FindingsView) {
				leaf.view.update(result, view);
			}
		}
	}

	private showRhythmNotice(): void {
		const result = this.analysis.analyzeActiveNote();
		if (!result) {
			new Notice('Plumbline: open a note to see its prose rhythm.');
			return;
		}
		new Notice(rhythmDetail(result));
	}

	private showScriptureUsage(): void {
		const view = this.analysis.activeMarkdownView();
		if (!view) {
			new Notice('Plumbline: open a note first.');
			return;
		}
		const usage = summarizeScripture(
			scriptureReferences(view.editor.getValue()),
		);
		if (usage.totalVerses === 0) {
			new Notice('Plumbline: no scripture citations in this note.');
			return;
		}
		const lines = Object.entries(usage.byTranslation).map(
			([translation, entry]) => `${translation}: ${entry.verses} verses`,
		);
		new Notice(`Scripture usage\n${lines.join('\n')}`);
	}

	// Compare each quoted verse against the vault's Bible corpus and report
	// possible mismatches. Verses it cannot find in the corpus are skipped.
	private async checkScripture(): Promise<void> {
		try {
			const view = this.analysis.activeMarkdownView();
			if (!view) {
				new Notice('Plumbline: open a note first.');
				return;
			}
			const quotes = scriptureQuotes(view.editor.getValue());
			if (quotes.length === 0) {
				new Notice('Plumbline: no quoted scripture in this note.');
				return;
			}
			let checked = 0;
			const mismatches: string[] = [];
			for (const item of quotes) {
				const corpusText = await this.corpus.verseText(item.citation);
				if (corpusText === null) {
					continue;
				}
				checked++;
				if (!verseMatches(item.quote, corpusText)) {
					const c = item.citation;
					mismatches.push(`${c.book} ${c.chapter}:${c.verseStart}`);
				}
			}
			if (checked === 0) {
				new Notice(
					'Plumbline: could not find these verses in the corpus.',
				);
			} else if (mismatches.length === 0) {
				new Notice(
					`Plumbline: ${checked} quoted verses checked, all match the corpus.`,
				);
			} else {
				new Notice(
					`Plumbline: ${mismatches.length} of ${checked} may not match the corpus:\n${mismatches.slice(0, 6).join('\n')}`,
				);
			}
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not check scripture.');
		}
	}

	// Aggregate scripture citations across the whole vault (excluding the Bible
	// corpus) and check each translation's distinct-verse total against its cap.
	private async checkVerseCaps(): Promise<void> {
		try {
			const files = this.app.vault
				.getMarkdownFiles()
				.filter((file) => !file.path.startsWith('10-bibles/'));
			// Copyright caps count reproduced verses, so use quoted scripture
			// only, not bare cross-references.
			const citations: Citation[] = [];
			for (const file of files) {
				const text = await this.app.vault.cachedRead(file);
				citations.push(...scriptureQuotes(text).map((q) => q.citation));
			}
			const usage = summarizeCaps(citations);
			if (usage.length === 0) {
				new Notice(
					'Plumbline: no scripture citations found in the vault.',
				);
				return;
			}
			const lines = usage.slice(0, 8).map((u) => {
				const cap = u.cap !== null ? ` / ${u.cap}` : '';
				const over = u.exceeds ? '  OVER CAP' : '';
				return `${u.translation}: ${u.verses}${cap} verses${over}`;
			});
			new Notice(
				`Verse caps, ${files.length} notes\n${lines.join('\n')}`,
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not check verse caps.');
		}
	}

	// Write the active note's findings as JSON into the vault, so an AI
	// collaborator on the filesystem reads what the editor shows. The internal
	// try/catch keeps the void'd command body from leaking a rejection.
	private async writeReport(): Promise<void> {
		try {
			const view = this.analysis.activeMarkdownView();
			const file = view?.file;
			if (!view || !file) {
				new Notice('Plumbline: open a note first.');
				return;
			}
			const report = buildReport(
				file.path,
				this.settings.activeProfile,
				view.editor.getValue(),
				this.analysis.analyze(view),
			);
			const dir = '.plumbline';
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			const reportPath = `${dir}/${file.path.split('/').join('-')}.json`;
			await adapter.write(reportPath, JSON.stringify(report, null, 2));
			new Notice(
				`Plumbline: wrote ${report.findings.length} flags to ${reportPath}`,
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not write the report.');
		}
	}
}
