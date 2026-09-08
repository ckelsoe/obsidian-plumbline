import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { PlumblineSettingTab } from './settings-tab';
import { AnalysisService } from './analysis-service';
import { rhythmStatusText, rhythmDetail } from './rhythm-format';
import type { EditorView } from '@codemirror/view';
import { plumblineDecorations, relintEditor } from './editor-decorations';
import { PlumblineApiImpl } from './api';
import { overlapsAnchor } from './annoteca-guard';
import {
	REPORT_DIR,
	REPORT_INDEX_PATH,
	ReportIndexEntry,
	emptyIndex,
	parseIndex,
	reportPathFor,
	upsertEntry,
} from './report-index';
import { FindingsView, FINDINGS_VIEW_TYPE } from './findings-view';
import { LintResult, ResolvedConfig } from './engine/types';
import { fileScope } from './engine/file-scope';
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
	// The read-only surface other plugins call, contract section 6. Public and
	// named `api` because that is the property the contract tells a consumer to
	// reach for on the plugin instance.
	readonly api = new PlumblineApiImpl(this);
	private vaultConfig: VaultConfig = EMPTY_VAULT_CONFIG;
	// Serializes config writes so two quick toggles cannot interleave their
	// read-modify-write of the file and drop one.
	private saveQueue: Promise<void> = Promise.resolve();
	// Serializes report-index writes for the same reason. The index is a
	// read-modify-write over one file, so two report commands overlapping would
	// both read the same index and the second write would drop the first note's
	// entry. Reachable by running the report, switching notes, and running it
	// again before the first write lands.
	private indexQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadVaultConfig();
		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new PlumblineSettingTab(this.app, this));

		// Underline flagged phrases in the editor, live.
		this.registerEditorExtension(
			plumblineDecorations((text) => this.resolvedConfig(text), {
				disableRule: (slug, view) => {
					void this.disableRuleForView(slug, view);
				},
				canReplace: (view, from, to) =>
					this.canReplaceRange(view, from, to),
			}),
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

	// The resolved config for a note, with vault overrides applied.
	//
	// `text` is optional so callers with no document (commands over a path, the
	// settings tab listing rules) keep working, but every caller that HAS the
	// text should pass it: the note's own `plumbline-profile` frontmatter or
	// `profile` directive selects which pack set is active, and that decision has
	// to happen before the config is resolved rather than inside lint().
	resolvedConfig(text?: string): ResolvedConfig {
		const profile =
			(text !== undefined ? fileScope(text).profileId : undefined) ??
			this.settings.activeProfile;
		return resolveConfig(profile, this.vaultConfig);
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

	// Apply a single on/off toggle to one of the vault config's disabled lists,
	// serialized through the save queue, then re-analyze so it shows in the editor,
	// panel, and status bar at once.
	private async persistToggle(
		field: 'disabledRules' | 'disabledSpanKinds',
		id: string,
		enabled: boolean,
	): Promise<void> {
		this.saveQueue = this.saveQueue.then(() =>
			this.writeToggle(field, id, enabled),
		);
		await this.saveQueue;
		this.applyConfigChange();
	}

	// Toggle one built-in rule on or off in the vault config's disabled list.
	async setRuleEnabled(slug: string, enabled: boolean): Promise<void> {
		await this.persistToggle('disabledRules', slug, enabled);
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
		await this.persistToggle('disabledSpanKinds', kind, enabled);
	}

	// Read the current config, apply one toggle to the named disabled list, and
	// write it back, preserving every other field. If the file exists but is not a
	// JSON object (mid hand-edit, an array, or otherwise malformed), abort with a
	// notice rather than overwrite and lose the author's content. The toggle is
	// applied to the freshly read list, so a concurrent edit to the other list or
	// to any other field survives. Never throws, so the save queue keeps draining.
	private async writeToggle(
		field: 'disabledRules' | 'disabledSpanKinds',
		id: string,
		enabled: boolean,
	): Promise<void> {
		try {
			const dir = '.plumbline';
			const path = `${dir}/config.json`;
			const adapter = this.app.vault.adapter;
			let raw: Record<string, unknown> = {};
			if (await adapter.exists(path)) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(await adapter.read(path));
				} catch (err) {
					console.error(err);
					new Notice(
						'Plumbline: config.json is not valid JSON; left it untouched.',
					);
					return;
				}
				if (
					typeof parsed !== 'object' ||
					parsed === null ||
					Array.isArray(parsed)
				) {
					new Notice(
						'Plumbline: config.json is not a JSON object; left it untouched.',
					);
					return;
				}
				raw = parsed as Record<string, unknown>;
			} else if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			const fresh = parseVaultConfig(raw);
			const current =
				field === 'disabledRules'
					? fresh.disabledRules
					: fresh.disabledSpanKinds;
			raw[field] = PlumblinePlugin.toggledList(current, id, enabled);
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
		// refresh() notifies for the active note. Everything else open gets told
		// below, deduplicated by PATH: one note can be open in several leaves,
		// and a consumer does not want the same change three times because the
		// user has a split view.
		const active = this.analysis.activeMarkdownView()?.file?.path;
		this.refresh();
		const notified = new Set<string>(active === undefined ? [] : [active]);
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
				// Notified for EVERY open note, not just the active one that
				// refresh() covered. A profile switch or a rule toggle changes
				// the findings for all of them at once, and a consumer showing a
				// background note would otherwise keep a stale lane until that
				// note happened to be typed in.
				const path = view.file?.path;
				if (path !== undefined && !notified.has(path)) {
					notified.add(path);
					this.api.emitFindingsChanged(path);
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
		// Every recomputation of this note's findings, whatever caused it: a
		// keystroke, a leaf change, a config reload. A consumer holding a lane
		// for this path needs to hear about all of them.
		const path = view.file?.path;
		if (path !== undefined) {
			this.api.emitFindingsChanged(path);
		}
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
			// The note's own profile, not the vault setting. The findings below
			// were computed under it, so stamping the report with the vault
			// profile would make the file disagree with its own contents.
			const text = view.editor.getValue();
			const report = buildReport(
				file.path,
				this.resolvedConfig(text).profileId,
				text,
				this.analysis.analyze(view),
			);
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(REPORT_DIR))) {
				await adapter.mkdir(REPORT_DIR);
			}
			const reportPath = reportPathFor(file.path);
			await adapter.write(reportPath, JSON.stringify(report, null, 2));
			await this.updateReportIndex({
				file: file.path,
				report: reportPath,
				profile: report.profile,
				findings: report.findings.length,
				updated: new Date().toISOString(),
			});
			new Notice(
				`Plumbline: wrote ${report.findings.length} flags to ${reportPath}`,
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not write the report.');
		}
	}

	// The MarkdownView driving a given CodeMirror editor.
	//
	// The only reliable link between a CodeMirror view and a note: Obsidian's
	// editor exposes its `cm`, so the leaf whose editor IS this view is the one
	// that owns it. Matching on the active leaf instead would be a guess.
	private markdownViewFor(view: EditorView): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const candidate = leaf.view;
			if (
				candidate instanceof MarkdownView &&
				candidate.editor.cm === view
			) {
				return candidate;
			}
		}
		return null;
	}

	// Whether Plumbline may replace a range of prose.
	//
	// Interop-contract 4.1 makes Annoteca the only writer of note prose, because
	// its reject-as-revert holds a byte-for-byte original and that is only true
	// if one system performed the replacement. A one-click fix is a prose write,
	// so it yields wherever Annoteca has an anchor. Everywhere else, and whenever
	// Annoteca is not installed, it goes ahead: the edit is user-initiated, one
	// phrase, and lands in the editor's own undo history.
	private canReplaceRange(
		view: EditorView,
		from: number,
		to: number,
	): boolean {
		const anchors = this.annotecaAnchors(view);
		if (anchors === null) {
			return true;
		}
		return !overlapsAnchor(anchors, from, to);
	}

	// Annoteca's anchor ranges for this editor's text, or null when Annoteca is
	// absent or too new to understand. Resolved at call time per contract 4.5,
	// and computed from the LIVE editor text, because the on-disk copy is stale
	// while there are unsaved edits.
	private annotecaAnchors(
		view: EditorView,
	): readonly { start: number; end: number }[] | null {
		try {
			const plugin: unknown = this.app.plugins.getPlugin('annoteca');
			if (plugin === null || typeof plugin !== 'object') {
				return null;
			}
			const api: unknown = (plugin as { api?: unknown }).api;
			if (api === null || typeof api !== 'object') {
				return null;
			}
			const { apiVersion, anchorsFor } = api as {
				apiVersion?: unknown;
				anchorsFor?: unknown;
			};
			// Degrade on an unknown version rather than guess, per contract 7.
			if (typeof apiVersion !== 'number' || apiVersion < 1) {
				return null;
			}
			if (typeof anchorsFor !== 'function') {
				return null;
			}
			const anchors: unknown = (
				anchorsFor as (content: string) => unknown
			).call(api, view.state.doc.toString());
			if (!Array.isArray(anchors)) {
				return null;
			}
			return anchors.filter(
				(a): a is { start: number; end: number } =>
					typeof a === 'object' &&
					a !== null &&
					typeof (a as { start?: unknown }).start === 'number' &&
					typeof (a as { end?: unknown }).end === 'number',
			);
		} catch (err) {
			// A consumer of another plugin's API never lets that plugin's failure
			// become this one's. Refusing the fix is the safe answer, but a
			// broken neighbour should not disable a local feature either, so this
			// reports "no anchors known" and the caller allows the edit.
			console.error(err);
			return null;
		}
	}

	// Turn a rule off for the note THIS editor is showing, by adding it to that
	// note's own `plumbline-disabled-rules` frontmatter.
	//
	// Frontmatter rather than an inline directive: the button says "here",
	// meaning this note, and a key at the top is visible and editable later. An
	// inline `<!-- plumbline: disable ... -->` would be buried wherever the
	// pointer happened to be.
	//
	// Written through `processFrontMatter`, which is Obsidian's supported way to
	// edit frontmatter. Hand-editing the text would put this plugin in the
	// business of serialising YAML into a note, which is the class of thing
	// interop-contract 4.1 keeps to one owner.
	private async disableRuleForView(
		slug: string,
		view: EditorView,
	): Promise<void> {
		try {
			// Resolved from the view that raised the hover, not from whatever is
			// active now. A hover survives a leaf change, so "the active note"
			// could be a different file by the time the button is pressed, and
			// this write would land in it.
			const file = this.markdownViewFor(view)?.file;
			if (!file) {
				new Notice('Plumbline: that note is no longer open.');
				return;
			}
			let already = false;
			// Typed at the boundary. Obsidian declares the callback's argument as
			// `any`, so without this every read off it is an unsafe access.
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					const raw: unknown = fm['plumbline-disabled-rules'];
					// Tolerant of what is already there: a hand-written single
					// value, a list, or nothing. A malformed key is replaced rather
					// than appended to, since appending to a string would produce
					// neither a list nor a scalar.
					const current = Array.isArray(raw)
						? raw.filter((v): v is string => typeof v === 'string')
						: typeof raw === 'string'
							? [raw]
							: [];
					if (current.includes(slug)) {
						already = true;
						return;
					}
					fm['plumbline-disabled-rules'] = [...current, slug];
				},
			);
			new Notice(
				already
					? `Plumbline: ${slug} is already off in this note.`
					: `Plumbline: ${slug} is off in this note.`,
			);
			// The frontmatter write is a document change, so the debounced pass
			// will re-lint on its own. This makes it immediate, which is what a
			// button press should look like.
			this.applyConfigChange();
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not turn that rule off.');
		}
	}

	// Record this note's report in the vault-level index, so a headless
	// collaborator finds every report by reading one file instead of walking the
	// vault and guessing which JSON belongs to which note.
	//
	// Read-modify-write, so a missing or hand-mangled index costs the stale
	// entries rather than this write: parseIndex treats anything unreadable as
	// empty. The index is a derived convenience and every report file is still
	// self-describing, so rebuilding it costs one re-run per note.
	private async updateReportIndex(entry: ReportIndexEntry): Promise<void> {
		// Chained rather than awaited directly, so overlapping report commands
		// queue behind each other instead of racing the read.
		this.indexQueue = this.indexQueue.then(
			() => this.writeReportIndex(entry),
			() => this.writeReportIndex(entry),
		);
		await this.indexQueue;
	}

	private async writeReportIndex(entry: ReportIndexEntry): Promise<void> {
		const adapter = this.app.vault.adapter;
		let index = emptyIndex();
		if (await adapter.exists(REPORT_INDEX_PATH)) {
			try {
				index = parseIndex(
					JSON.parse(
						await adapter.read(REPORT_INDEX_PATH),
					) as unknown,
				);
			} catch (err) {
				// Unparseable JSON, not merely an unexpected shape. Logged and
				// replaced rather than thrown, because losing the index must not
				// lose the report that was just written.
				console.error(err);
			}
		}
		await adapter.write(
			REPORT_INDEX_PATH,
			JSON.stringify(upsertEntry(index, entry), null, 2),
		);
	}
}
