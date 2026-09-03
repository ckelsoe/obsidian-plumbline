import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { PlumblineSettingTab } from './settings-tab';
import { AnalysisService } from './analysis-service';
import { rhythmStatusText, rhythmDetail } from './rhythm-format';
import { plumblineDecorations, relintEditor } from './editor-decorations';
import { FindingsView, FINDINGS_VIEW_TYPE } from './findings-view';
import { LintResult, ResolvedConfig } from './engine/types';
import { buildReport } from './report';
import { scriptureReferences, scriptureQuotes } from './engine/scripture';
import { summarizeScripture, Citation } from './engine/citation';
import { verseMatches } from './engine/verbatim';
import { summarizeCaps } from './engine/verse-caps';
import { kdpDisclosure } from './engine/kdp';
import { CorpusService } from './corpus-service';
import {
	COMMENT_SPAN_KINDS,
	SpanKindInfo,
	profileRuleInfos,
	RuleInfo,
	resolveConfig,
} from './engine/config';
import {
	VaultConfig,
	EMPTY_VAULT_CONFIG,
	parseVaultConfig,
} from './engine/vault-config';

// One built-in rule (mechanical or heuristic), paired with whether the vault
// config currently has it on. Drives the settings list so a rule can be toggled
// without hand-editing JSON.
interface RuleState extends RuleInfo {
	enabled: boolean;
}

// One toggleable comment span kind, paired with whether masking is currently on.
interface SpanKindState extends SpanKindInfo {
	enabled: boolean;
}

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
	// The raw parsed JSON of the vault config, kept verbatim so a settings toggle
	// rewrites only the lists it owns (`disabledRules`, `disabledSpanKinds`) and
	// leaves every other hand-authored field (overrides, custom rules, anything the
	// parser does not model yet) intact.
	private vaultConfigRaw: Record<string, unknown> = {};
	// Serializes config writes so two quick toggles cannot interleave their
	// read-modify-write of the file and drop one.
	private saveQueue: Promise<void> = Promise.resolve();

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
		this.addCommand({
			id: 'show-kdp-disclosure',
			name: 'Show AI disclosure for the active note',
			callback: () => {
				this.showKdpDisclosure();
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
				this.vaultConfigRaw = {};
				return;
			}
			const raw: unknown = JSON.parse(await adapter.read(path));
			this.vaultConfigRaw =
				typeof raw === 'object' && raw !== null
					? (raw as Record<string, unknown>)
					: {};
			this.vaultConfig = parseVaultConfig(raw);
		} catch (err) {
			console.error(err);
			this.vaultConfig = EMPTY_VAULT_CONFIG;
			this.vaultConfigRaw = {};
		}
	}

	private async reloadVaultConfig(): Promise<void> {
		await this.loadVaultConfig();
		this.applyConfigChange();
		new Notice('Plumbline: reloaded config.');
	}

	// The built-in rules for the active profile, mechanical and heuristic, each
	// paired with whether the vault config currently has it enabled. The settings
	// tab renders this.
	profileRuleStates(): RuleState[] {
		const disabled = new Set(this.vaultConfig.disabledRules);
		return profileRuleInfos(this.settings.activeProfile).map((info) => ({
			...info,
			enabled: !disabled.has(info.slug),
		}));
	}

	// Add or remove an id from a disabled list, returning the new array. The one
	// place the enable/disable set arithmetic lives, for both rules and span kinds.
	private static toggledList(
		list: string[],
		id: string,
		enabled: boolean,
	): string[] {
		const set = new Set(list);
		if (enabled) {
			set.delete(id);
		} else {
			set.add(id);
		}
		return [...set];
	}

	// Persist the config and re-analyze everywhere, so a toggle shows in the
	// editor, panel, and status bar at once.
	private async persistAndApply(): Promise<void> {
		await this.saveVaultConfig();
		this.applyConfigChange();
	}

	// Toggle one built-in rule on or off in the vault config's disabled list.
	async setRuleEnabled(slug: string, enabled: boolean): Promise<void> {
		this.vaultConfig = {
			...this.vaultConfig,
			disabledRules: PlumblinePlugin.toggledList(
				this.vaultConfig.disabledRules,
				slug,
				enabled,
			),
		};
		await this.persistAndApply();
	}

	// The toggleable comment span kinds, each paired with whether masking is on.
	// The settings tab renders this.
	commentSpanStates(): SpanKindState[] {
		const disabled = new Set(this.vaultConfig.disabledSpanKinds);
		return COMMENT_SPAN_KINDS.map((info) => ({
			...info,
			enabled: !disabled.has(info.kind),
		}));
	}

	// Toggle masking of one comment kind on or off.
	async setSpanKindEnabled(kind: string, enabled: boolean): Promise<void> {
		this.vaultConfig = {
			...this.vaultConfig,
			disabledSpanKinds: PlumblinePlugin.toggledList(
				this.vaultConfig.disabledSpanKinds,
				kind,
				enabled,
			),
		};
		await this.persistAndApply();
	}

	// Persist the vault config, serialized through the save queue so overlapping
	// toggles apply in order rather than racing on the same file.
	private async saveVaultConfig(): Promise<void> {
		this.saveQueue = this.saveQueue.then(() => this.writeVaultConfig());
		await this.saveQueue;
	}

	// Write the vault config back to disk, rewriting only `disabledRules`. The
	// file is re-read first, so a hand-edit or sync since load is preserved rather
	// than clobbered by a stale in-memory snapshot, and every other field (custom
	// rules, overrides, anything the parser does not model) is left as authored.
	// Never throws, so a failure does not wedge the save queue.
	private async writeVaultConfig(): Promise<void> {
		try {
			const dir = '.plumbline';
			const path = `${dir}/config.json`;
			const adapter = this.app.vault.adapter;
			let raw: Record<string, unknown> = {};
			if (await adapter.exists(path)) {
				try {
					const parsed: unknown = JSON.parse(
						await adapter.read(path),
					);
					if (typeof parsed === 'object' && parsed !== null) {
						raw = parsed as Record<string, unknown>;
					}
				} catch (err) {
					// A malformed file on disk is not a reason to lose the toggle;
					// start from an empty object and rewrite it cleanly.
					console.error(err);
				}
			} else if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			raw.disabledRules = this.vaultConfig.disabledRules;
			raw.disabledSpanKinds = this.vaultConfig.disabledSpanKinds;
			this.vaultConfigRaw = raw;
			// Keep the in-memory config consistent with the merged file, so any
			// external overrides or custom rules take effect from now on too.
			this.vaultConfig = parseVaultConfig(raw);
			await adapter.write(path, JSON.stringify(raw, null, 2));
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not save the config.');
		}
	}

	// Re-run analysis everywhere after the active config changes (profile switch,
	// rule toggle, config reload): status bar, findings panel, and the editor's
	// live underlines.
	applyConfigChange(): void {
		this.refresh();
		// Re-lint every open Markdown editor, not just the active one, since the
		// change affects all of them. In reading view the CodeMirror editor may not
		// be mounted, so guard the handle.
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const cm = view.editor.cm;
				if (cm) {
					relintEditor(cm);
				}
			}
		}
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

	// Read the active note's `provenance` frontmatter and report the KDP AI
	// disclosure it implies (ruleset rule 28).
	private showKdpDisclosure(): void {
		const view = this.analysis.activeMarkdownView();
		if (!view?.file) {
			new Notice('Plumbline: open a note first.');
			return;
		}
		const frontmatter = this.app.metadataCache.getFileCache(
			view.file,
		)?.frontmatter;
		const raw: unknown = frontmatter?.provenance;
		const provenance = typeof raw === 'string' ? raw : '';
		if (provenance === '') {
			new Notice(
				'Plumbline: add a "provenance" field (cold, AI-edited, or AI-drafted) to this note.',
			);
			return;
		}
		const guidance = kdpDisclosure(provenance);
		if (!guidance) {
			new Notice(
				`Plumbline: unknown provenance "${provenance}". Use cold, AI-edited, or AI-drafted.`,
			);
			return;
		}
		new Notice(
			`AI disclosure\nCategory: ${guidance.category}\nDisclose to Amazon: ${guidance.disclose ? 'yes' : 'no'}\n${guidance.note}`,
		);
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
