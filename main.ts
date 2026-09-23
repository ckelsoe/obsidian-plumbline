import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { PlumblineSettingTab } from './settings-tab';
import { AnalysisService } from './analysis-service';
import { rhythmStatusText, rhythmDetail } from './rhythm-format';
import type { EditorView } from '@codemirror/view';
import { plumblineDecorations, relintEditor } from './editor-decorations';
import { PlumblineApiImpl } from './api';
import { overlapsAnchor } from './annoteca-guard';
import {
	DEFAULT_INLINE_UNDERLINES,
	isInlineUnderlines,
	type CommentAnchor,
	type InlineUnderlines,
} from './yield-to-comments';
import { AnnotateModal } from './annotate-modal';
import type { AnnotecaApi } from './annoteca-api';
import {
	PROMOTE_CATEGORY,
	PromoteRequest,
	promoteRequestFor,
} from './promote-request';
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
import {
	Diagnostic,
	LintResult,
	ResolvedConfig,
	Severity,
} from './engine/types';
import { fileScope } from './engine/file-scope';
import { lint } from './engine/lint';
import { buildReport } from './report';
import { scriptureReferences, scriptureQuotes } from './engine/scripture';
import { summarizeScripture, Citation } from './engine/citation';
import { verseMatches } from './engine/verbatim';
import { summarizeCaps } from './engine/verse-caps';
import { kdpDisclosure } from './engine/kdp';
import { CorpusService } from './corpus-service';
import { ReferenceService } from './reference-service';
import {
	COMMENT_SPAN_KINDS,
	SpanKindInfo,
	CheckDescriptor,
	groupCheckDescriptors,
	describeCheck,
	isCheckEnabledInGroup,
	prettifySlug,
	resolveConfig,
} from './engine/config';
import {
	CustomCheck,
	USER_CHECKS_PATH,
	CUSTOM_PACK_ID,
	isBuiltInSlug,
	parseUserChecks,
	serializeUserChecks,
	findCustomCheck,
} from './engine/check-store';
import {
	VaultConfig,
	EMPTY_VAULT_CONFIG,
	parseVaultConfig,
} from './engine/vault-config';
import {
	CheckMembership,
	GroupDefinition,
	fallbackGroup,
	migrateGroupId,
} from './engine/groups';
import {
	USER_GROUPS_PATH,
	parseUserGroups,
	serializeUserGroups,
	findGroup,
	allGroups,
	hasFlatTuning,
	buildMigratedGroup,
} from './engine/group-store';
import { BASE_PACK_ID, BASE_RULES } from './engine/packs';
import { SCRIPTURE_PACK_ID, SCRIPTURE_RULES } from './engine/scripture';
import { DEFAULT_ROLLUP_THRESHOLD, CONFIDENCE } from './engine/rollup';

// One check as the settings tab shows it, resolved against the active group: its
// identity, whether it is on, and the tuning knobs both at their check default and
// as the group's membership overrides them. Drives the active-rules list, the
// library picker, and the check editor, so a check can be composed and retuned
// without hand-editing JSON. See config-model.md, per-membership tuning.
export interface CheckState {
	slug: string;
	// Editable display name for a custom check; undefined for a built-in, whose
	// label the settings tab derives from the slug.
	name?: string;
	packId: string;
	category: string;
	message: string;
	isHeuristic: boolean;
	isCustom: boolean;
	enabled: boolean;
	// Severity: the check's own default, the group override (null when inheriting),
	// and the effective value the two resolve to.
	defaultSeverity: Severity;
	overrideSeverity: Severity | null;
	effectiveSeverity: Severity;
	// Confidence: the check's default (from its tier) and the group override, 0..1.
	defaultConfidence: number;
	overrideConfidence: number | null;
	// Roll-up: the group's threshold and this check's per-membership override.
	groupRollupThreshold: number;
	overrideRollup: number | null;
}

// One toggleable comment span kind, paired with whether masking is currently on.
interface SpanKindState extends SpanKindInfo {
	enabled: boolean;
}

export interface PlumblineSettings {
	// The active group id selects which packs and checks are on and how they are
	// tuned. Groups and the check library are specified in config-model.md. The
	// field keeps the name activeProfile because the note-level selector is still
	// spelled `plumbline-profile`; the value it holds is a group id.
	activeProfile: string;
	// Whether flagged phrases are underlined in the editor, and whether the
	// underline yields to Annoteca's open comments. Interop-contract 5.1.
	inlineUnderlines: InlineUnderlines;
}

export const DEFAULT_SETTINGS: PlumblineSettings = {
	activeProfile: 'devotional-nonfiction',
	inlineUnderlines: DEFAULT_INLINE_UNDERLINES,
};

// Debounce for live re-analysis while typing, in milliseconds.
const REFRESH_DELAY = 400;

export default class PlumblinePlugin extends Plugin {
	// A fresh copy, so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PlumblineSettings = { ...DEFAULT_SETTINGS };

	private readonly analysis = new AnalysisService(this);
	private readonly corpus = new CorpusService(this);
	// Named files and folders that reference-driven checks read, and which groups
	// use them. See config-model.md, "References".
	readonly references = new ReferenceService(this);
	private legacyScriptureFolder = '';
	private settingTab: PlumblineSettingTab | null = null;

	// A vault event changed a reference (a rename it followed, or a re-check after
	// a delete or restore). The settings tab caches its rows, so rebuild them or
	// the References page shows the old path and status.
	onReferencesChanged(): void {
		this.settingTab?.update();
	}
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
	// The user's own groups, loaded from .plumbline/groups.json. The built-in
	// starters live in code; these are the editable ones. The active group is one
	// of the starters or one of these. See config-model.md, "What lives where".
	private userGroups: GroupDefinition[] = [];
	// The user's custom checks, loaded from .plumbline/checks.json. Built-in checks
	// ship in the packs (code); these are the editable, deletable library entries.
	// A group turns a custom check on per membership (default off). See
	// config-model.md, "Built-in checks versus custom checks".
	private userChecks: CustomCheck[] = [];
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
		await this.loadUserGroups();
		await this.loadUserChecks();
		await this.migrateFlatTuning();
		await this.references.load();
		await this.migrateScriptureFolder();
		this.statusBar = this.addStatusBarItem();
		this.settingTab = new PlumblineSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Underline flagged phrases in the editor, live.
		this.registerEditorExtension(
			plumblineDecorations(
				(text) => this.resolvedConfig(text),
				{
					disableRule: (slug, view) => {
						void this.disableRuleForView(slug, view);
					},
					canReplace: (view, from, to) =>
						this.canReplaceRange(view, from, to),
					canAnnotate: () => this.annotecaPromoteApi() !== null,
					annotate: (view, diagnostic) => {
						void this.annotateFinding(view, diagnostic);
					},
					revealInPanel: (view, diagnostic) => {
						void this.revealFindingInPanel(view, diagnostic);
					},
				},
				{
					inlineUnderlines: () => this.settings.inlineUnderlines,
					commentAnchors: (text) => this.commentAnchorsFor(text),
				},
			),
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
			id: 'promote-findings',
			name: 'Add comments for the findings in this note',
			callback: () => {
				void this.promoteAllFindings();
			},
		});
		this.addCommand({
			id: 'write-folder-reports',
			name: 'Write flags reports for every note in this folder',
			callback: () => {
				void this.writeFolderReports();
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
			checkCallback: (checking) => {
				if (!this.scriptureCommandAvailable()) {
					return false;
				}
				if (!checking) {
					this.showScriptureUsage();
				}
				return true;
			},
		});
		this.addCommand({
			id: 'check-quoted-scripture',
			name: 'Check quoted scripture for the active note',
			checkCallback: (checking) => {
				if (!this.scriptureCommandAvailable()) {
					return false;
				}
				if (!checking) {
					void this.checkScripture();
				}
				return true;
			},
		});
		this.addCommand({
			id: 'check-verse-caps',
			name: 'Check verse caps across the vault',
			checkCallback: (checking) => {
				if (!this.scriptureCommandAvailable()) {
					return false;
				}
				if (!checking) {
					void this.checkVerseCaps();
				}
				return true;
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
			// Folder lookups need the vault index, which is complete only once the
			// layout is ready, so reference validation waits for it. The vault
			// listeners are registered here too: during load Obsidian fires a
			// create event for every file, which would re-check each reference
			// once per file.
			void this.references.validateAll();
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					void this.references.onVaultRename(file, oldPath);
				}),
			);
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					this.references.onVaultChange(file);
				}),
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					this.references.onVaultChange(file);
				}),
			);
			// An edit to a chapter note can add or remove its verse markers. Only
			// files inside a reference folder queue a re-check, so ordinary
			// writing costs a path comparison per save.
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					this.references.onVaultChange(file);
				}),
			);
		});
	}

	// Move the 0.2.1 "Scripture folder" setting into a "Bible text" reference used
	// by every group that draws on the scripture pack, starters included (a
	// starter can use a reference without being forked), then drop the setting.
	private async migrateScriptureFolder(): Promise<void> {
		const scriptureGroupIds = allGroups(this.userGroups)
			.filter((group) => group.extends.includes(SCRIPTURE_PACK_ID))
			.map((group) => group.id);
		if (
			await this.references.migrateScriptureFolder(
				this.legacyScriptureFolder,
				scriptureGroupIds,
			)
		) {
			this.legacyScriptureFolder = '';
			await this.saveSettings();
		}
	}

	// The group a note is checked with: its own plumbline-profile frontmatter or
	// directive when it has one, else the active group.
	groupForText(text: string): GroupDefinition {
		const id = fileScope(text).profileId ?? this.settings.activeProfile;
		return findGroup(id, this.userGroups) ?? fallbackGroup();
	}

	// Scripture commands show only when the note in front of the writer is checked
	// with a group that draws on the scripture pack.
	private scriptureCommandAvailable(): boolean {
		const view = this.analysis.activeMarkdownView();
		const group = view
			? this.groupForText(view.editor.getValue())
			: this.activeGroup();
		return group.extends.includes(SCRIPTURE_PACK_ID);
	}

	onunload(): void {
		this.clearRefreshTimer();
		this.references.dispose();
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
			// A value stored under the pre-rename `scripture-book` id migrates to
			// its current spelling, so the dropdown shows the right group selected.
			activeProfile:
				typeof record.activeProfile === 'string'
					? migrateGroupId(record.activeProfile)
					: DEFAULT_SETTINGS.activeProfile,
			inlineUnderlines: isInlineUnderlines(record.inlineUnderlines)
				? record.inlineUnderlines
				: DEFAULT_SETTINGS.inlineUnderlines,
		};
		// 0.2.1 stored a flat scriptureFolder setting. It is read once here so
		// onload can migrate it into a reference; it is no longer a setting, so
		// the next save drops it from data.json.
		this.legacyScriptureFolder =
			typeof record.scriptureFolder === 'string'
				? record.scriptureFolder
				: '';
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
		const config = resolveConfig(
			profile,
			this.vaultConfig,
			this.userGroups,
			this.userChecks,
		);
		// Term lists the note's group uses add their own rules. They come from
		// references (vault files), not from packs, so they join here rather
		// than inside the pure resolver.
		const group = findGroup(profile, this.userGroups) ?? fallbackGroup();
		const termRules = this.references.termRules(group.id);
		return termRules.length > 0
			? { ...config, rules: [...config.rules, ...termRules] }
			: config;
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
		await this.loadUserGroups();
		await this.loadUserChecks();
		this.applyConfigChange();
		new Notice('Plumbline: reloaded config.');
	}

	// Load the user's groups from the vault. A missing file is the common case (no
	// custom groups yet) and resolves to an empty list, not an error.
	private async loadUserGroups(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(USER_GROUPS_PATH))) {
				this.userGroups = [];
				return;
			}
			this.userGroups = parseUserGroups(
				JSON.parse(await adapter.read(USER_GROUPS_PATH)) as unknown,
			);
		} catch (err) {
			console.error(err);
			this.userGroups = [];
		}
	}

	// Persist the user groups to the vault, serialized through the save queue so a
	// group edit and a membership edit cannot interleave their writes. Only user
	// groups are written; the built-in starters are code, not data.
	private async saveUserGroups(): Promise<void> {
		this.saveQueue = this.saveQueue.then(() => this.writeUserGroups());
		await this.saveQueue;
	}

	private async writeUserGroups(): Promise<void> {
		try {
			const dir = '.plumbline';
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			await adapter.write(
				USER_GROUPS_PATH,
				serializeUserGroups(this.userGroups),
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not save the groups.');
		}
	}

	// The group in effect for the settings tab: the active starter or user group,
	// or the base-only fallback if the stored id resolves to nothing.
	activeGroup(): GroupDefinition {
		return (
			findGroup(this.settings.activeProfile, this.userGroups) ??
			fallbackGroup()
		);
	}

	// The user's own groups (not the starters). The settings tab combines these
	// with the built-in starters through allGroups() for the dropdown and the list.
	groups(): GroupDefinition[] {
		return [...this.userGroups];
	}

	// One user group by id, the mutable object held in userGroups, or undefined.
	// Starters are read-only and are never returned here.
	private userGroupById(id: string): GroupDefinition | undefined {
		return this.userGroups.find((group) => group.id === id);
	}

	// Create a new, empty base-only user group and make it active. Returns its id so
	// the settings tab can open its editor.
	async createGroup(): Promise<string> {
		const group: GroupDefinition = {
			id: this.uniqueGroupId('my-group'),
			name: 'New group',
			builtIn: false,
			extends: [BASE_PACK_ID],
			rollupThreshold: DEFAULT_ROLLUP_THRESHOLD,
			checks: {},
		};
		this.userGroups.push(group);
		this.settings.activeProfile = group.id;
		await this.saveUserGroups();
		await this.saveSettings();
		this.applyConfigChange();
		return group.id;
	}

	// Duplicate any group (a starter or a user group) into a new editable user group
	// and make it active. This is how a read-only starter is customized. Returns the
	// new id, or null if the source id resolves to nothing.
	async duplicateGroup(sourceId: string): Promise<string | null> {
		const source = findGroup(sourceId, this.userGroups);
		if (!source) {
			return null;
		}
		const copy: GroupDefinition = {
			id: this.uniqueGroupId(source.id),
			name: `${source.name} (copy)`,
			builtIn: false,
			extends: [...source.extends],
			rollupThreshold: source.rollupThreshold,
			checks: structuredClone(source.checks),
		};
		this.userGroups.push(copy);
		this.settings.activeProfile = copy.id;
		await this.references.copyAssignments(source.id, copy.id);
		await this.saveUserGroups();
		await this.saveSettings();
		this.applyConfigChange();
		return copy.id;
	}

	// Delete a user group. A starter is read-only and is never deleted here. If the
	// deleted group was active, fall back to the devotional starter so the plugin
	// always has a valid active group.
	async deleteGroup(id: string): Promise<void> {
		const index = this.userGroups.findIndex((group) => group.id === id);
		if (index === -1) {
			return;
		}
		this.userGroups.splice(index, 1);
		await this.references.dropAssignments(id);
		if (this.settings.activeProfile === id) {
			this.settings.activeProfile = DEFAULT_SETTINGS.activeProfile;
		}
		await this.saveUserGroups();
		await this.saveSettings();
		this.applyConfigChange();
	}

	// Apply a mutation to one user group and persist it. A starter cannot be edited,
	// so a non-user id is a no-op. Re-analyzes, which matters when the edited group
	// is the active one.
	private async mutateGroup(
		id: string,
		mutate: (group: GroupDefinition) => void,
	): Promise<void> {
		const group = this.userGroupById(id);
		if (!group) {
			return;
		}
		mutate(group);
		await this.saveUserGroups();
		this.applyConfigChange();
	}

	// Rename a user group.
	async renameGroup(id: string, name: string): Promise<void> {
		await this.mutateGroup(id, (group) => {
			group.name = name;
		});
	}

	// Set a user group's roll-up threshold.
	async setGroupRollupThreshold(
		id: string,
		threshold: number,
	): Promise<void> {
		await this.mutateGroup(id, (group) => {
			group.rollupThreshold = threshold;
		});
	}

	// Turn the scripture pack on or off for a user group. The base pack is always
	// present, so only the scripture pack is toggled here.
	async setGroupScripture(id: string, include: boolean): Promise<void> {
		await this.mutateGroup(id, (group) => {
			const packs = new Set(group.extends);
			if (include) {
				packs.add(SCRIPTURE_PACK_ID);
			} else {
				packs.delete(SCRIPTURE_PACK_ID);
			}
			packs.add(BASE_PACK_ID);
			group.extends = [...packs];
		});
	}

	// A group id not already taken by a starter or a user group, derived from a
	// base by appending -2, -3, and so on. Keeps a duplicated or migrated group
	// from colliding with the one it came from.
	private uniqueGroupId(base: string): string {
		const taken = (id: string): boolean =>
			findGroup(id, this.userGroups) !== undefined;
		if (!taken(base)) {
			return base;
		}
		let n = 2;
		while (taken(`${base}-${n}`)) {
			n += 1;
		}
		return `${base}-${n}`;
	}

	// The active group as an editable user group. A read-only starter is forked
	// into a user copy the first time it is tuned, and that copy becomes active, so
	// the settings controls always write somewhere editable and a starter is never
	// mutated. Returns the group object held in `userGroups`, ready to mutate.
	private ensureEditableActiveGroup(): GroupDefinition {
		const active = this.activeGroup();
		if (!active.builtIn) {
			return active;
		}
		const copy: GroupDefinition = {
			id: this.uniqueGroupId(active.id),
			name: `${active.name} (my copy)`,
			builtIn: false,
			extends: [...active.extends],
			rollupThreshold: active.rollupThreshold,
			checks: structuredClone(active.checks),
		};
		this.userGroups.push(copy);
		this.settings.activeProfile = copy.id;
		// The fork keeps checking against the same references. Not awaited: this
		// runs inside a synchronous fork, and the caller saves groups right after.
		void this.references.copyAssignments(active.id, copy.id);
		new Notice(`Plumbline: made an editable copy of ${active.name}.`);
		return copy;
	}

	// Apply a mutation to one check's membership in the active group, forking a
	// starter first if needed, dropping a membership that ends up empty so the file
	// stays sparse, then persisting and re-analyzing. The mutator clears a field by
	// deleting it, so there is no "set to undefined" case to reason about.
	private async mutateMembership(
		slug: string,
		mutate: (membership: CheckMembership) => void,
	): Promise<void> {
		const group = this.ensureEditableActiveGroup();
		const next: CheckMembership = { ...group.checks[slug] };
		mutate(next);
		if (Object.keys(next).length === 0) {
			delete group.checks[slug];
		} else {
			group.checks[slug] = next;
		}
		await this.saveUserGroups();
		await this.saveSettings();
		this.applyConfigChange();
	}

	// One-time migration of phase-2's flat tuning (rule toggles, severity
	// overrides, roll-up threshold, confidence) from .plumbline/config.json into an
	// editable group. Before groups, those lived in the vault config; the group
	// model makes the active group the one place tuning lives. Runs only when there
	// are no user groups yet, so it forks the active starter once and never again,
	// and never fires for a vault that has already moved to groups.
	private async migrateFlatTuning(): Promise<void> {
		if (this.userGroups.length > 0) {
			return;
		}
		if (!hasFlatTuning(this.vaultConfig)) {
			return;
		}
		try {
			const starter = this.activeGroup();
			const migrated = buildMigratedGroup(
				starter,
				this.vaultConfig,
				this.uniqueGroupId(starter.id),
			);
			this.userGroups.push(migrated);
			this.settings.activeProfile = migrated.id;
			await this.writeUserGroups();
			await this.saveSettings();
			// Clear the migrated fields from the vault config so they are not
			// applied twice, once by the group and once by the flat layer, and so a
			// later membership edit is authoritative. Hand-authored message and
			// phrase overrides and custom rules are left untouched.
			await this.clearMigratedFlatTuning();
		} catch (err) {
			console.error(err);
		}
	}

	// Remove the tuning migrateFlatTuning moved into a group from config.json,
	// keeping everything else the file holds. A severity-only override entry is
	// dropped whole; an entry that also carries a message or phrases keeps those.
	private async clearMigratedFlatTuning(): Promise<void> {
		await this.writeConfig((raw, fresh) => {
			delete raw.disabledRules;
			delete raw.rollupThreshold;
			delete raw.confidence;
			const overrides: Record<string, unknown> = {};
			for (const [slug, ov] of Object.entries(fresh.overrides)) {
				const rest: Record<string, unknown> = { ...ov };
				delete rest.severity;
				if (Object.keys(rest).length > 0) {
					overrides[slug] = rest;
				}
			}
			raw.overrides = overrides;
		});
	}

	// One check descriptor resolved against a group into the CheckState the settings
	// tab renders: whether it is on in that group, and each tuning knob at its check
	// default plus the group's membership override. The one place the descriptor to
	// state mapping lives, shared by the active-rules list, the library, the editor,
	// and the migration display.
	private toCheckState(
		descriptor: CheckDescriptor,
		group: GroupDefinition,
	): CheckState {
		const membership = group.checks[descriptor.slug];
		const overrideSeverity = membership?.severity ?? null;
		const overrideConfidence =
			typeof membership?.confidence === 'number'
				? membership.confidence
				: null;
		const overrideRollup =
			typeof membership?.rollup === 'number' ? membership.rollup : null;
		return {
			slug: descriptor.slug,
			name: descriptor.name,
			packId: descriptor.packId,
			category: descriptor.category,
			message: descriptor.message,
			isHeuristic: descriptor.isHeuristic,
			isCustom: descriptor.isCustom,
			enabled: isCheckEnabledInGroup(group, descriptor),
			defaultSeverity: descriptor.defaultSeverity,
			overrideSeverity,
			effectiveSeverity: overrideSeverity ?? descriptor.defaultSeverity,
			defaultConfidence: descriptor.defaultConfidence,
			overrideConfidence,
			groupRollupThreshold: group.rollupThreshold,
			overrideRollup,
		};
	}

	// The checks shown in the active group's "Active rules" list: every built-in
	// pack and heuristic check (on or off, so the ruleset is visible and toggleable)
	// plus the custom checks the group has enabled. An off custom check is not an
	// active rule; it lives in the library until turned on.
	activeCheckStates(): CheckState[] {
		const group = this.activeGroup();
		return groupCheckDescriptors(group, this.userChecks)
			.filter(
				(descriptor) =>
					!descriptor.isCustom ||
					isCheckEnabledInGroup(group, descriptor),
			)
			.map((descriptor) => this.toCheckState(descriptor, group));
	}

	// Every check available to the active group for the library picker: the pack
	// checks it draws from and all custom checks, each with its on/off state so a
	// tick can add or remove it. Off custom checks are included, unlike the
	// active-rules list.
	libraryCheckStates(): CheckState[] {
		const group = this.activeGroup();
		return groupCheckDescriptors(group, this.userChecks).map((descriptor) =>
			this.toCheckState(descriptor, group),
		);
	}

	// One check's state for the check editor, or undefined if the slug resolves to
	// nothing (a custom check deleted while its editor was open).
	checkState(slug: string): CheckState | undefined {
		const descriptor = describeCheck(slug, this.userChecks);
		if (!descriptor) {
			return undefined;
		}
		return this.toCheckState(descriptor, this.activeGroup());
	}

	// The names of the groups a check is on in, for the editor's "in groups" line.
	// Reads across the starters and the user groups, so it answers "where does
	// turning this check off actually change something".
	inGroupNames(slug: string): string[] {
		const descriptor = describeCheck(slug, this.userChecks);
		if (!descriptor) {
			return [];
		}
		return allGroups(this.userGroups)
			.filter((group) => isCheckEnabledInGroup(group, descriptor))
			.map((group) => group.name);
	}

	// The roll-up threshold in effect: the active group's. The settings tab shows
	// this and lets the writer change it without hand-editing a file.
	currentRollupThreshold(): number {
		return this.activeGroup().rollupThreshold;
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

	// Apply a comment-span-kind toggle to the vault config's disabled-span list,
	// serialized through the save queue, then re-analyze so it shows in the editor,
	// panel, and status bar at once. Rule enable/disable lives on the active group
	// now, not in the vault config, so this serves the span toggles alone.
	private async persistSpanKindToggle(
		kind: string,
		enabled: boolean,
	): Promise<void> {
		this.saveQueue = this.saveQueue.then(() =>
			this.writeSpanKindToggle(kind, enabled),
		);
		await this.saveQueue;
		this.applyConfigChange();
	}

	// Toggle one built-in rule on or off for the active group. On is the default,
	// so an enabled check stores nothing and only "off" is recorded, which keeps
	// the group definition sparse.
	async setCheckEnabled(slug: string, enabled: boolean): Promise<void> {
		// The defaults run opposite ways, so a sparse membership records only the
		// deviation: a pack or heuristic check is on unless a membership turns it
		// off, so "on" clears the flag; a custom check is off unless a membership
		// turns it on, so "off" clears it. Either way the not-deviating state stores
		// nothing.
		const isCustom = findCustomCheck(slug, this.userChecks) !== undefined;
		await this.mutateMembership(slug, (membership) => {
			if (isCustom) {
				if (enabled) {
					membership.enabled = true;
				} else {
					delete membership.enabled;
				}
			} else if (enabled) {
				delete membership.enabled;
			} else {
				membership.enabled = false;
			}
		});
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
		await this.persistSpanKindToggle(kind, enabled);
	}

	// Set or clear a rule's severity override in the active group. Passing the
	// rule's own default (null from the settings tab) clears the override, so the
	// group never accumulates a no-op entry; any other value writes it.
	async setRuleSeverity(
		slug: string,
		severity: Severity | null,
	): Promise<void> {
		await this.mutateMembership(slug, (membership) => {
			if (severity === null) {
				delete membership.severity;
			} else {
				membership.severity = severity;
			}
		});
	}

	// Set or clear a check's confidence override in the active group. Null clears it
	// so the check falls back to its record's confidence; any value is range-clamped
	// when the group resolves.
	async setRuleConfidence(
		slug: string,
		confidence: number | null,
	): Promise<void> {
		await this.mutateMembership(slug, (membership) => {
			if (confidence === null) {
				delete membership.confidence;
			} else {
				membership.confidence = confidence;
			}
		});
	}

	// Set or clear a check's per-membership roll-up override in the active group.
	// Null clears it so the check falls back to the group's threshold; roll-up is
	// the one knob whose default lives on the group (config-model.md).
	async setRuleRollup(slug: string, rollup: number | null): Promise<void> {
		await this.mutateMembership(slug, (membership) => {
			if (rollup === null) {
				delete membership.rollup;
			} else {
				membership.rollup = rollup;
			}
		});
	}

	// Set the roll-up threshold on the active group, forking a starter first if
	// needed, then re-analyze. A bad value is clamped when the group resolves.
	async setRollupThreshold(threshold: number): Promise<void> {
		const group = this.ensureEditableActiveGroup();
		group.rollupThreshold = threshold;
		await this.saveUserGroups();
		await this.saveSettings();
		this.applyConfigChange();
	}

	// The custom checks, for the settings tab's library and "Your custom checks"
	// list. A copy, so a caller cannot mutate the store in place.
	customCheckList(): CustomCheck[] {
		return [...this.userChecks];
	}

	// Load the custom checks from the vault. A missing file is the common case and
	// resolves to an empty list, not an error, matching loadUserGroups.
	private async loadUserChecks(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(USER_CHECKS_PATH))) {
				this.userChecks = [];
				return;
			}
			this.userChecks = parseUserChecks(
				JSON.parse(await adapter.read(USER_CHECKS_PATH)) as unknown,
			);
		} catch (err) {
			console.error(err);
			this.userChecks = [];
		}
	}

	// Persist the custom checks, serialized through the save queue so a check edit
	// and a group edit cannot interleave their writes.
	private async saveUserChecks(): Promise<void> {
		this.saveQueue = this.saveQueue.then(() => this.writeUserChecks());
		await this.saveQueue;
	}

	private async writeUserChecks(): Promise<void> {
		try {
			const dir = '.plumbline';
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			await adapter.write(
				USER_CHECKS_PATH,
				serializeUserChecks(this.userChecks),
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not save the custom checks.');
		}
	}

	// A check slug not already taken by a built-in or a custom check, derived from a
	// base by appending -2, -3, and so on. A custom check may never take a built-in
	// slug, or it would collide with the locked pack check.
	private uniqueCheckSlug(base: string): string {
		const clean = base.length > 0 ? base : 'custom-check';
		const taken = (slug: string): boolean =>
			isBuiltInSlug(slug) ||
			this.userChecks.some((check) => check.slug === slug) ||
			// Also avoid a legacy global custom rule in .plumbline/config.json: a
			// shared slug would let resolveConfig add the library copy AND have
			// mergeRules append the legacy one, doubling every diagnostic.
			this.vaultConfig.rules.some((rule) => rule.slug === slug);
		if (!taken(clean)) {
			return clean;
		}
		let n = 2;
		while (taken(`${clean}-${n}`)) {
			n += 1;
		}
		return `${clean}-${n}`;
	}

	// A slug from a display name: lower case, non-alphanumeric runs to single
	// hyphens, trimmed. Empty (a name of only punctuation) falls back to the caller.
	private static slugify(name: string): string {
		// The first replace collapses every non-alphanumeric run to a single
		// hyphen, so at most one hyphen can sit at each end; a single-character
		// strip is enough and avoids the backtracking a `-+` anchor would risk.
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-/, '')
			.replace(/-$/, '');
	}

	// Create a new, empty custom phrase check and return its slug. It is added to
	// the library but not to any group; the writer turns it on from the library.
	// A name gives it a readable label and seeds a stable slug.
	async createCustomCheck(name?: string): Promise<string> {
		const display = name?.trim() ? name.trim() : 'New check';
		const slug = this.uniqueCheckSlug(
			PlumblinePlugin.slugify(display) || 'custom-check',
		);
		this.userChecks.push({
			slug,
			name: display,
			message: 'Custom check.',
			category: CUSTOM_PACK_ID,
			severity: 'suggestion',
			phrases: [],
		});
		await this.saveUserChecks();
		this.applyConfigChange();
		return slug;
	}

	// Edit a custom check's definition (name, message, phrases). A built-in check's
	// matching is locked, so a non-custom slug is a no-op. Re-analyzes, which
	// matters when the check is on in the active group.
	async updateCustomCheck(
		slug: string,
		patch: Partial<Pick<CustomCheck, 'name' | 'message' | 'phrases'>>,
	): Promise<void> {
		const check = findCustomCheck(slug, this.userChecks);
		if (!check) {
			return;
		}
		// Name and message must stay non-empty: parseUserChecks drops a check with
		// an empty name or message, so persisting one the user cleared would make
		// the whole check vanish on the next load. An all-whitespace edit keeps the
		// previous value rather than writing an unloadable record. Phrases may be
		// empty (a check with no phrases simply matches nothing).
		if (patch.name !== undefined && patch.name.trim().length > 0) {
			check.name = patch.name;
		}
		if (patch.message !== undefined && patch.message.trim().length > 0) {
			check.message = patch.message;
		}
		if (patch.phrases !== undefined) {
			check.phrases = patch.phrases;
		}
		await this.saveUserChecks();
		this.applyConfigChange();
	}

	// Delete a custom check and remove its membership from every user group, so no
	// group is left referencing a check that no longer exists. A built-in is not
	// deletable, so a non-custom slug is a no-op.
	async deleteCustomCheck(slug: string): Promise<void> {
		const index = this.userChecks.findIndex((check) => check.slug === slug);
		if (index === -1) {
			return;
		}
		this.userChecks.splice(index, 1);
		let groupsChanged = false;
		for (const group of this.userGroups) {
			if (group.checks[slug]) {
				delete group.checks[slug];
				groupsChanged = true;
			}
		}
		await this.saveUserChecks();
		if (groupsChanged) {
			await this.saveUserGroups();
		}
		this.applyConfigChange();
	}

	// Fork any check into an editable custom copy and return its slug, or null if
	// the source resolves to nothing. This is how a built-in's locked matching is
	// customized: the copy carries the source's phrases, message, and severity, and
	// is editable and deletable. A heuristic has no phrase list to fork, so it is
	// refused (null). The copy is added to the library, not to any group.
	async duplicateCheckToCustom(sourceSlug: string): Promise<string | null> {
		const descriptor = describeCheck(sourceSlug, this.userChecks);
		if (!descriptor || descriptor.isHeuristic) {
			return null;
		}
		const phrases = this.checkPhrases(sourceSlug);
		if (phrases === undefined) {
			return null;
		}
		const baseName = descriptor.name ?? prettifySlug(sourceSlug);
		const slug = this.uniqueCheckSlug(
			PlumblinePlugin.slugify(baseName) || 'custom-check',
		);
		const copy: CustomCheck = {
			slug,
			name: `${baseName} (copy)`,
			message: descriptor.message,
			category: CUSTOM_PACK_ID,
			severity: descriptor.defaultSeverity,
			phrases: [...phrases],
			// Copy the check's OWN default confidence, not the active group's
			// per-membership override. That override is group-specific, like
			// severity and roll-up, and the user re-applies it on the copy; a
			// duplicate captures the check's definition, not one group's tuning
			// (roll-up cannot live on a custom check at all, only on a membership).
			// Written only when non-default, to keep the record sparse.
			...(descriptor.defaultConfidence !== CONFIDENCE.mechanical
				? { confidence: descriptor.defaultConfidence }
				: {}),
		};
		this.userChecks.push(copy);
		await this.saveUserChecks();
		this.applyConfigChange();
		return slug;
	}

	// The phrase list behind a check slug: the custom check's own phrases, or a
	// built-in phrase rule's. Undefined when the slug is unknown or names a
	// heuristic, which matches on structure rather than a phrase list.
	private checkPhrases(slug: string): string[] | undefined {
		const custom = findCustomCheck(slug, this.userChecks);
		if (custom) {
			return custom.phrases;
		}
		const rule = [...BASE_RULES, ...SCRIPTURE_RULES].find(
			(r) => r.slug === slug,
		);
		return rule?.phrases;
	}

	// Safe read-modify-write for .plumbline/config.json. Reads the current file,
	// aborting with a notice if it is not a JSON object (mid hand-edit, an array,
	// or otherwise malformed) so the author's content is never overwritten, hands
	// the raw object and its parsed form to `mutate`, then re-parses into
	// vaultConfig and writes it back. Every field `mutate` leaves alone survives,
	// so a concurrent edit elsewhere in the file is preserved. Never throws, so
	// the save queue keeps draining.
	private async writeConfig(
		mutate: (raw: Record<string, unknown>, fresh: VaultConfig) => void,
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
			mutate(raw, fresh);
			this.vaultConfig = parseVaultConfig(raw);
			await adapter.write(path, JSON.stringify(raw, null, 2));
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not save the config.');
		}
	}

	// Toggle one comment-span kind in the disabled-span list, applied to the freshly
	// read list so a concurrent edit elsewhere in the file is preserved.
	private async writeSpanKindToggle(
		kind: string,
		enabled: boolean,
	): Promise<void> {
		await this.writeConfig((raw, fresh) => {
			raw.disabledSpanKinds = PlumblinePlugin.toggledList(
				fresh.disabledSpanKinds,
				kind,
				enabled,
			);
		});
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

	// Turn every finding in the active note into comments, in one call.
	//
	// A COMMAND, not a setting, and never automatic. Contract 3.4 is explicit
	// that there is no "promote all" that happens on its own: a finding is
	// ephemeral and a comment is permanent, and 7.2 says a comment is never
	// auto-deleted when its finding goes away. Automatic promotion plus never
	// auto-deleting is a ratchet, where every false positive becomes a thread
	// the writer has to close by hand forever.
	//
	// What 3.4 does allow is exactly this: one deliberate action, with the count
	// shown before anything is written. The count comes from Annoteca's own
	// promotion budget, so the confirmation is the one the user already has.
	//
	// Sent as ONE call rather than a loop, so the budget sees the real total and
	// asks once. A loop would slip under the budget every time and defeat it.
	private async promoteAllFindings(): Promise<void> {
		try {
			const view = this.analysis.activeMarkdownView();
			const file = view?.file;
			const api = this.annotecaPromoteApi();
			if (!view || !file) {
				new Notice('Plumbline: open a note first.');
				return;
			}
			if (api === null) {
				new Notice('Plumbline: Annoteca is not available.');
				return;
			}
			const text = view.editor.getValue();
			const result = lint(text, this.resolvedConfig(text));
			const requests = result.diagnostics
				.map((d) =>
					promoteRequestFor(d, text.slice(d.start, d.end), ''),
				)
				.filter((r): r is PromoteRequest => r !== null);
			if (requests.length === 0) {
				new Notice('Plumbline: nothing to add here.');
				return;
			}
			const created = await api.promote(file.path, requests, text);
			new Notice(
				created.length === 0
					? 'Plumbline: added nothing. They may already have comments.'
					: `Plumbline: added ${created.length} comment${created.length === 1 ? '' : 's'}.`,
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not add the comments.');
		}
	}

	// Show a finding in the panel, opening the panel first if it is not up.
	//
	// The refresh runs before the reveal: a panel that has just opened has not
	// rendered any rows yet, so focusing one immediately finds nothing.
	private async revealFindingInPanel(
		view: EditorView,
		diagnostic: Diagnostic,
	): Promise<void> {
		try {
			// Only for the note that raised the click, so a click in one split
			// does not repoint a panel showing another note.
			const mdView = this.markdownViewFor(view);
			if (!mdView) return;
			await this.activateFindingsView();
			// From the clicked editor, not the active one.
			this.refreshFor(mdView);
			for (const leaf of this.app.workspace.getLeavesOfType(
				FINDINGS_VIEW_TYPE,
			)) {
				const panel = leaf.view;
				if (panel instanceof FindingsView) {
					panel.revealFinding(diagnostic.ruleSlug, diagnostic.start);
				}
			}
		} catch (err) {
			console.error(err);
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
		this.refreshFor(view);
	}

	// Recompute and push the panel for a SPECIFIC editor.
	//
	// Split out because a click on an underline has to refresh the note that was
	// clicked, not whatever the workspace calls active. The handler runs on
	// mousedown, before focus moves, so in a split the active leaf is still the
	// other one and the panel would be filled with a different note's findings.
	private refreshFor(view: MarkdownView): void {
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

	// Compare each quoted verse against the quote-source references the note's
	// group uses, and report possible mismatches. A verse none of them contains is
	// skipped. With several sources, a quote that matches any one of them passes;
	// one that matches none is listed with every source it was checked against.
	private async checkScripture(): Promise<void> {
		try {
			const view = this.analysis.activeMarkdownView();
			if (!view) {
				new Notice('Plumbline: open a note first.');
				return;
			}
			const text = view.editor.getValue();
			const quotes = scriptureQuotes(text);
			if (quotes.length === 0) {
				new Notice('Plumbline: no quoted scripture in this note.');
				return;
			}
			const group = this.groupForText(text);
			const sources = this.references.quoteSourceFolders(group.id);
			if (sources.length === 0) {
				new Notice(
					`Plumbline: ${group.name} has no valid quote source. Add one under References in settings, then turn it on for this group.`,
				);
				return;
			}
			let checked = 0;
			const mismatches: string[] = [];
			for (const item of quotes) {
				const found: { name: string; text: string }[] = [];
				for (const source of sources) {
					const verse = await this.corpus.verseText(
						source.folder,
						item.citation,
					);
					if (verse !== null) {
						found.push({
							name: source.reference.name,
							text: verse,
						});
					}
				}
				if (found.length === 0) {
					continue;
				}
				checked++;
				if (!found.some((f) => verseMatches(item.quote, f.text))) {
					const c = item.citation;
					const against = found.map((f) => f.name).join(', ');
					mismatches.push(
						`${c.book} ${c.chapter}:${c.verseStart} (${against})`,
					);
				}
			}
			if (checked === 0) {
				new Notice(
					`Plumbline: could not find these verses in ${sources.map((s) => s.reference.name).join(', ')}.`,
				);
			} else if (mismatches.length === 0) {
				new Notice(
					`Plumbline: ${checked} quoted verses checked, all match.`,
				);
			} else {
				new Notice(
					`Plumbline: ${mismatches.length} of ${checked} may not match:\n${mismatches.slice(0, 6).join('\n')}`,
				);
			}
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not check scripture.');
		}
	}

	// Aggregate scripture citations across the whole vault (excluding every
	// quote-source reference folder, whose verses are the reference text, not
	// reproductions) and check each translation's distinct-verse total against
	// its cap.
	private async checkVerseCaps(): Promise<void> {
		try {
			const sourcePrefixes = this.references
				.allQuoteSourcePaths()
				.map((path) => `${path}/`);
			const files = this.app.vault
				.getMarkdownFiles()
				.filter(
					(file) =>
						!sourcePrefixes.some((prefix) =>
							file.path.startsWith(prefix),
						),
				);
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
			const reportPath = await this.persistReport(file.path, report);
			new Notice(
				`Plumbline: wrote ${report.findings.length} flags to ${reportPath}`,
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not write the report.');
		}
	}

	// Annoteca's promote surface, or null when it is absent or too old.
	//
	// Resolved at call time per contract 4.5, never held across the other
	// plugin's reload. `promote` arrived with apiVersion 2, so 1 is a real
	// Annoteca that cannot take a promotion and degrades to no button.
	private annotecaPromoteApi(): Pick<AnnotecaApi, 'promote'> | null {
		try {
			const plugin: unknown = this.app.plugins.getPlugin('annoteca');
			if (plugin === null || typeof plugin !== 'object') {
				return null;
			}
			const api: unknown = (plugin as { api?: unknown }).api;
			if (api === null || typeof api !== 'object') {
				return null;
			}
			const { apiVersion, promote } = api as {
				apiVersion?: unknown;
				promote?: unknown;
			};
			if (typeof apiVersion !== 'number' || apiVersion < 2) {
				return null;
			}
			if (typeof promote !== 'function') {
				return null;
			}
			// Typed against the vendored public contract, so a change to Annoteca's
			// promote signature or its PromoteRequest is caught here at build time
			// rather than drifting. Runtime presence is still feature-detected above,
			// because an older Annoteca that predates promote does not carry it.
			return api as Pick<AnnotecaApi, 'promote'>;
		} catch (err) {
			console.error(err);
			return null;
		}
	}

	// Turn one finding into an Annoteca comment.
	//
	// The one-way bridge in contract 2: a finding is computed and disappears when
	// the prose changes, a comment is written into the note and is the record. It
	// is promoted only on this explicit click, one at a time, so the promotion
	// budget is never the thing standing between the user and a surprise.
	private async annotateFinding(
		view: EditorView,
		diagnostic: Diagnostic,
	): Promise<void> {
		try {
			const api = this.annotecaPromoteApi();
			// Resolved from the view that raised the hover, not from whatever is
			// active by the time the click lands.
			const file = this.markdownViewFor(view)?.file;
			if (api === null || !file) {
				new Notice('Plumbline: Annoteca is not available here.');
				return;
			}
			// The text the anchor offsets were computed against. Annoteca refuses
			// a stale snapshot rather than writing a marker onto moved prose, so
			// this has to be the LIVE editor text, not the copy on disk.
			const text = view.state.doc.toString();
			const phrase = text.slice(diagnostic.start, diagnostic.end);
			// Asked BEFORE the snapshot is used, because the writer may take a
			// while to type and the note can move on underneath them. The text
			// is re-read after the dialog closes and the anchors re-derived from
			// that, or Annoteca would refuse a stale snapshot.
			const chosen = await this.askForComment(
				phrase,
				diagnostic.ruleSlug,
				diagnostic.message,
			);
			if (chosen === null) {
				return;
			}
			const current = view.state.doc.toString();
			if (current !== text) {
				new Notice(
					'Plumbline: the note changed while you were typing. Try again.',
				);
				return;
			}
			const request = promoteRequestFor(
				diagnostic,
				phrase,
				chosen.note,
				chosen.category,
			);
			if (request === null) {
				new Notice('Plumbline: that finding has no stable ID yet.');
				return;
			}
			const created = await api.promote(file.path, [request], current);
			new Notice(
				created.length > 0
					? 'Plumbline: added an Annoteca comment.'
					: 'Plumbline: that finding is already annotated.',
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not add the comment.');
		}
	}

	// The writer's own words for a comment, or null if they backed out.
	//
	// A promoted comment carrying only the rule's message is a thread with
	// nothing in it to answer, which is the opposite of why anyone promotes a
	// finding. Empty is a real answer and distinct from null: it means record
	// the finding on its own.
	private askForComment(
		phrase: string,
		ruleSlug: string,
		message: string,
	): Promise<{ note: string; category: string } | null> {
		const categories = this.annotecaCategories();
		return new Promise((resolve) => {
			new AnnotateModal(
				this.app,
				phrase,
				ruleSlug,
				message,
				categories,
				PROMOTE_CATEGORY,
				resolve,
			).open();
		});
	}

	// Annoteca's categories, or an empty list when it cannot tell us.
	//
	// Empty means the dialog leaves the picker out rather than offering a
	// hardcoded list: this plugin does not own that set, and guessing it is how
	// it goes stale the first time the user adds or renames one. `categories()`
	// arrived after apiVersion 2 as an additive method, so it is feature-detected
	// rather than version-gated.
	private annotecaCategories(): { id: string; name: string }[] {
		try {
			const plugin: unknown = this.app.plugins.getPlugin('annoteca');
			if (plugin === null || typeof plugin !== 'object') return [];
			const api: unknown = (plugin as { api?: unknown }).api;
			if (api === null || typeof api !== 'object') return [];
			const { categories } = api as { categories?: unknown };
			if (typeof categories !== 'function') return [];
			const list: unknown = (categories as () => unknown).call(api);
			if (!Array.isArray(list)) return [];
			return list
				.filter(
					(c): c is { id: string; displayName: string } =>
						typeof c === 'object' &&
						c !== null &&
						typeof (c as { id?: unknown }).id === 'string' &&
						typeof (c as { displayName?: unknown }).displayName ===
							'string',
				)
				.map((c) => ({ id: c.id, name: c.displayName }));
		} catch (err) {
			console.error(err);
			return [];
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

	// Annoteca's anchors for this text, narrowed to what the yield reads.
	//
	// An empty list covers both "Annoteca is absent" and "this note has no
	// comments", which are the same answer to the only question the yield asks.
	commentAnchorsFor(text: string): readonly CommentAnchor[] {
		return (this.annotecaAnchorsFromText(text) ?? []).map((a) => ({
			start: a.start,
			end: a.end,
			resolved: a.resolved,
			addressed: a.addressed,
		}));
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
		const anchors = this.annotecaAnchorsFromText(view.state.doc.toString());
		if (anchors === null) {
			return true;
		}
		return !overlapsAnchor(anchors, from, to);
	}

	// Annoteca's anchor ranges for this editor's text, or null when Annoteca is
	// absent or too new to understand. Resolved at call time per contract 4.5,
	// and computed from the LIVE editor text, because the on-disk copy is stale
	// while there are unsaved edits.
	private annotecaAnchorsFromText(
		text: string,
	): readonly CommentAnchor[] | null {
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
			).call(api, text);
			if (!Array.isArray(anchors)) {
				return null;
			}
			return anchors
				.filter(
					(a): a is Record<string, unknown> =>
						typeof a === 'object' &&
						a !== null &&
						typeof (a as { start?: unknown }).start === 'number' &&
						typeof (a as { end?: unknown }).end === 'number',
				)
				.map((a) => ({
					start: a.start as number,
					end: a.end as number,
					// Absent reads as unresolved, which is the conservative
					// direction: it treats an anchor this build cannot classify
					// as one worth yielding to.
					resolved: a.resolved === true,
					// `addressed` arrived after Annoteca's apiVersion 2 as an
					// additive field, so an older build simply does not send it.
					// Feature-detected rather than version-gated.
					addressed:
						typeof a.addressed === 'boolean'
							? a.addressed
							: undefined,
				}));
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

	// Write one report and record it in the index. Shared by the single-note
	// command and the folder run, so a folder's reports are byte-identical to
	// the ones a reader would get by running the command on each note.
	private async persistReport(
		path: string,
		report: ReturnType<typeof buildReport>,
	): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(REPORT_DIR))) {
			await adapter.mkdir(REPORT_DIR);
		}
		const reportPath = reportPathFor(path);
		await adapter.write(reportPath, JSON.stringify(report, null, 2));
		await this.updateReportIndex({
			file: path,
			report: reportPath,
			profile: report.profile,
			findings: report.findings.length,
			updated: new Date().toISOString(),
		});
		return reportPath;
	}

	// Write a report for every Markdown note in the active note's folder.
	//
	// The whole point of the JSON report is a collaborator reading findings off
	// the filesystem, and that collaborator usually wants a chapter folder, not
	// one note. Doing it a note at a time was the difference between "hand me
	// your book" and "hand me your book, one file at a time".
	//
	// Reads each file rather than the editor, because only one note is open. A
	// note with unsaved edits is reported as SAVED, which is the honest answer
	// for a file-based artifact and is said in the notice.
	private async writeFolderReports(): Promise<void> {
		try {
			const active = this.analysis.activeMarkdownView()?.file;
			if (!active) {
				new Notice('Plumbline: open a note first.');
				return;
			}
			const folder = active.parent?.path ?? '';
			const files = this.app.vault
				.getMarkdownFiles()
				.filter((f) => (f.parent?.path ?? '') === folder)
				.sort((a, b) => a.path.localeCompare(b.path));
			if (files.length === 0) {
				new Notice('Plumbline: no notes in that folder.');
				return;
			}
			let written = 0;
			let findings = 0;
			let failed = 0;
			for (const file of files) {
				try {
					const text = await this.app.vault.cachedRead(file);
					const result = lint(text, this.resolvedConfig(text));
					const report = buildReport(
						file.path,
						this.resolvedConfig(text).profileId,
						text,
						result,
					);
					await this.persistReport(file.path, report);
					written += 1;
					findings += report.findings.length;
				} catch (err) {
					// One unreadable note does not cost the whole run. The
					// count in the notice is what actually landed.
					console.error(err);
					failed += 1;
				}
			}
			const where = folder === '' ? 'the vault root' : folder;
			new Notice(
				`Plumbline: wrote ${written} report${written === 1 ? '' : 's'} for ${where}, ${findings} findings.` +
					(failed > 0 ? ` ${failed} could not be read.` : ''),
			);
		} catch (err) {
			console.error(err);
			new Notice('Plumbline: could not write the reports.');
		}
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
