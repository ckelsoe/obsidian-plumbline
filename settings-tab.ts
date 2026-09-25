import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	SettingDefinition,
	SettingDefinitionItem,
	SettingDefinitionList,
	SettingPage,
} from 'obsidian';
import type PlumblinePlugin from './main';
import type { CheckState } from './main';
import { allGroups } from './engine/group-store';
import type { GroupDefinition } from './engine/groups';
import { SCRIPTURE_PACK_ID } from './engine/scripture';
import { prettifySlug } from './engine/config';
import type { Severity } from './engine/types';
import {
	REFERENCE_TYPE_LABELS,
	referenceTargetsFile,
	type Reference,
	type ReferenceType,
} from './engine/reference-store';
import { PathSuggest } from './path-suggest';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite. A discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';

// Declarative control keys are routed by prefix in getControlValue/setControlValue.
// A span: key toggles a comment span in the vault config; a lib: key toggles a
// check's membership in the active group; the roll-up key writes the active group's
// threshold. Every other key is a plugin setting. Check rows in the active-rules
// list and the check editor are page/imperative, so they do not pass through here.
const SPAN_KEY_PREFIX = 'span:';
const LIB_KEY_PREFIX = 'lib:';
const ROLLUP_KEY = 'rollup';

const SEVERITY_LABEL: Record<Severity, string> = {
	error: 'Error',
	warning: 'Warning',
	suggestion: 'Suggestion',
};

// The display label for a check: a custom check's editable name, or a built-in's
// slug prettified.
function checkLabel(state: Pick<CheckState, 'slug' | 'name'>): string {
	return state.name ?? prettifySlug(state.slug);
}

// A phrase list from the textarea: one per line, trimmed, blanks dropped.
function splitPhrases(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

// Does a check row match a library/active-rules search query? Matches the label
// and the message, case-insensitively, so a search finds a check by what it is
// called or by what it says.
function matchCheckDefinition(def: SettingDefinition, query: string): boolean {
	const q = query.toLowerCase();
	const name = (def.name ?? '').toLowerCase();
	const desc = typeof def.desc === 'string' ? def.desc.toLowerCase() : '';
	return name.includes(q) || desc.includes(q);
}

export class PlumblineSettingTab extends PluginSettingTab {
	plugin: PlumblinePlugin;

	constructor(app: App, plugin: PlumblinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Writing group',
				items: [
					{
						name: 'Active group',
						desc: 'The group of checks to run on your notes. A group turns a set of checks on and tunes them. The two starters are read-only worked examples; editing one makes an editable copy. A note can override this with a plumbline-profile key in its frontmatter.',
						control: {
							type: 'dropdown',
							key: 'activeProfile',
							options: this.groupOptions(),
						},
					},
					{
						type: 'page',
						name: 'Manage groups',
						desc: 'Create, rename, duplicate, and delete writing groups. The two starters are read-only; duplicate one to customize it.',
						displayValue: () => this.describeGroupCount(),
						items: [
							this.buildUserGroupList(),
							this.buildStarterGroupList(),
						],
					},
				],
			},
			{
				type: 'group',
				heading: 'Volume',
				items: [
					{
						name: 'Roll up a repeated check after',
						desc: 'When one check fires more than this many times in a note, the findings list shows a single counted row instead of one row per hit. Below the threshold each hit stays its own row.',
						control: {
							type: 'dropdown',
							key: ROLLUP_KEY,
							options: {
								'1': '1 hit',
								'2': '2 hits',
								'3': '3 hits',
								'4': '4 hits',
								'5': '5 hits',
								'6': '6 hits',
								'7': '7 hits',
								'8': '8 hits',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Inline marks',
				items: [
					{
						name: 'Underline flagged phrases',
						desc: 'Yield to comments hides the underline where an open Annoteca comment already marks the same words, so two plugins do not mark one passage at once. A comment you have resolved, or one with an edit waiting on you, does not hide it. The gutter bar and the findings panel always show everything.',
						control: {
							type: 'dropdown',
							key: 'inlineUnderlines',
							options: {
								always: 'Always',
								auto: 'Yield to comments',
								never: 'Never',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Comments',
				items: this.plugin.commentSpanStates().map((state) => ({
					name: state.name,
					desc: state.desc,
					control: {
						type: 'toggle' as const,
						key: `${SPAN_KEY_PREFIX}${state.kind}`,
					},
				})),
			},
			this.buildActiveRulesList(),
			{
				type: 'page',
				name: 'Check library',
				desc: 'Browse every check, create your own, and choose which run in the active group.',
				displayValue: () => this.describeLibraryCount(),
				items: [
					this.buildCustomCheckList(),
					this.buildBuiltinToggleList(),
				],
			},
			{
				type: 'page',
				name: 'References',
				desc: 'Files and folders your checks compare against, such as a brand voice file of terms to avoid, or Bible text for checking quoted verses. Define one here, then turn it on for each group that should use it.',
				displayValue: () => this.describeReferenceCount(),
				items: [this.buildReferenceList()],
			},
			{
				name: '',
				searchable: false,
				render: (setting: Setting) => {
					this.renderFooter(setting);
				},
			},
		];
	}

	// Binds declarative controls to their store. A span: key routes to the vault
	// config's disabled-span set; a lib: key routes to the active group's check
	// membership; the roll-up key routes to the active group; every other key is a
	// plugin setting. Rule rows and the check editor are page/imperative, so they do
	// not pass through here.
	getControlValue(key: string): unknown {
		if (key.startsWith(SPAN_KEY_PREFIX)) {
			const kind = key.slice(SPAN_KEY_PREFIX.length);
			return this.plugin
				.commentSpanStates()
				.some((state) => state.kind === kind && state.enabled);
		}
		if (key.startsWith(LIB_KEY_PREFIX)) {
			const slug = key.slice(LIB_KEY_PREFIX.length);
			return this.plugin.checkState(slug)?.enabled ?? false;
		}
		if (key === ROLLUP_KEY) {
			return String(this.plugin.currentRollupThreshold());
		}
		return (this.plugin.settings as unknown as Record<string, unknown>)[
			key
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(SPAN_KEY_PREFIX)) {
			const kind = key.slice(SPAN_KEY_PREFIX.length);
			await this.plugin.setSpanKindEnabled(kind, Boolean(value));
			return;
		}
		if (key.startsWith(LIB_KEY_PREFIX)) {
			const slug = key.slice(LIB_KEY_PREFIX.length);
			// Ticking a check in the library while a read-only starter is active
			// forks an editable copy and switches to it, so re-render the tab to
			// show the copy rather than the stale starter.
			await this.withActiveGroupRerender(() =>
				this.plugin.setCheckEnabled(slug, Boolean(value)),
			);
			return;
		}
		if (key === ROLLUP_KEY) {
			await this.withActiveGroupRerender(() =>
				this.plugin.setRollupThreshold(Number(value)),
			);
			return;
		}
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			value;
		await this.plugin.saveSettings();
		if (key === 'activeProfile') {
			// A new profile has a different rule set, so re-analyze and rebuild
			// the rules list below.
			this.plugin.applyConfigChange();
			this.update();
		}
		if (key === 'inlineUnderlines') {
			// Nothing in the document changed, so no pass is scheduled and the
			// decoration layer has no reason to recompute. Without this the
			// underlines keep whatever they were until the next keystroke, and
			// a setting that visibly does nothing reads as broken.
			this.plugin.applyConfigChange();
		}
	}

	// Run a tuning change, then re-render the whole tab if it switched the active
	// group. Tuning a read-only starter forks an editable copy and makes it active,
	// so the dropdown and the rows below would otherwise show the old group until
	// the tab was reopened.
	private async withActiveGroupRerender(
		change: () => Promise<void>,
	): Promise<void> {
		const before = this.plugin.settings.activeProfile;
		await change();
		if (this.plugin.settings.activeProfile !== before) {
			this.update();
		}
	}

	// The active-group dropdown options: every group the user can pick, starters
	// first, keyed by id. Built from live data so a new or renamed group shows
	// without a stale label.
	private groupOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (const group of allGroups(this.plugin.groups())) {
			options[group.id] = group.name;
		}
		return options;
	}

	// The built-in starter groups (base only, so no user groups are passed).
	private starterGroups(): GroupDefinition[] {
		return allGroups([]);
	}

	// One-line summary of a group for its list row: which packs it draws from and
	// how many checks it tunes away from the defaults.
	private describeGroup(group: GroupDefinition): string {
		const packs = group.extends.includes(SCRIPTURE_PACK_ID)
			? 'Base and scripture packs'
			: 'Base pack';
		const tuned = Object.keys(group.checks).length;
		return tuned === 0 ? packs : `${packs}, ${tuned} tuned`;
	}

	// Count shown on the "Manage groups" entry so the state reads without opening it.
	private describeGroupCount(): string {
		const starters = this.starterGroups().length;
		const yours = this.plugin.groups().length;
		const yoursLabel =
			yours === 0 ? 'none of your own' : `${yours} of your own`;
		return `${starters} starters, ${yoursLabel}`;
	}

	// Count shown on the "Check library" entry: how many custom checks exist.
	private describeReferenceCount(): string {
		const count = this.plugin.references.list().length;
		return count === 0
			? 'none yet'
			: `${count} reference${count === 1 ? '' : 's'}`;
	}

	// Every reference, each opening its editor, with delete on the row and a New
	// reference affordance. The row shows whether the reference checks out.
	private buildReferenceList(): SettingDefinitionList {
		return {
			type: 'list',
			heading: 'Your references',
			emptyState:
				'No references yet. Add one with New reference, choose its folder, then turn it on in a group.',
			onDelete: (index: number) => {
				const reference = this.plugin.references.list()[index];
				if (!reference) {
					return;
				}
				void (async () => {
					await this.plugin.references.delete(reference.id);
					new Notice(`Plumbline: deleted ${reference.name}.`);
					this.update();
				})();
			},
			addItem: {
				name: 'New reference',
				action: () => {
					void (async () => {
						await this.plugin.references.create();
						this.update();
					})();
				},
			},
			items: this.plugin.references.list().map((reference) => ({
				type: 'page' as const,
				name: reference.name,
				desc:
					reference.path ||
					(referenceTargetsFile(reference.type)
						? 'No note chosen'
						: 'No folder chosen'),
				displayValue: () => this.describeReferenceStatus(reference.id),
				page: () => new ReferenceEditorPage(this, reference.id),
			})),
		};
	}

	describeReferenceStatus(id: string): string {
		const state = this.plugin.references.status(id)?.state;
		if (state === 'ok') {
			return 'OK';
		}
		if (state === 'missing') {
			return 'Missing';
		}
		return state === 'invalid' ? 'Needs attention' : 'Checking';
	}

	private describeLibraryCount(): string {
		const custom = this.plugin.customCheckList().length;
		return custom === 0
			? 'no custom checks yet'
			: `${custom} custom check${custom === 1 ? '' : 's'}`;
	}

	// The user's editable groups: each opens an editor, with delete on the row and
	// a New group affordance. The delete index is into this same filtered list.
	private buildUserGroupList(): SettingDefinitionList {
		const groups = this.plugin.groups();
		return {
			type: 'list',
			heading: 'Your groups',
			emptyState:
				'No groups of your own yet. Create one, or duplicate a starter below.',
			onDelete: (index: number) => {
				const group = this.plugin.groups()[index];
				if (!group) {
					return;
				}
				void (async () => {
					await this.plugin.deleteGroup(group.id);
					new Notice(`Plumbline: deleted ${group.name}.`);
					this.update();
				})();
			},
			addItem: {
				name: 'New group',
				action: () => {
					void (async () => {
						await this.plugin.createGroup();
						this.update();
					})();
				},
			},
			items: groups.map((group) => ({
				type: 'page' as const,
				name: group.name,
				desc: this.describeGroup(group),
				page: () => new GroupEditorPage(this, group.id),
			})),
		};
	}

	// The read-only starter groups: each opens the editor, which offers Duplicate
	// and leaves the fields locked. No delete affordance, since a starter cannot be
	// removed.
	private buildStarterGroupList(): SettingDefinitionList {
		return {
			type: 'list',
			heading: 'Starter groups',
			items: this.starterGroups().map((group) => ({
				type: 'page' as const,
				name: group.name,
				desc: this.describeGroup(group),
				page: () => new GroupEditorPage(this, group.id),
			})),
		};
	}

	// The active group's checks: every built-in pack and heuristic check (on or
	// off) plus the custom checks the group has enabled, each opening the check
	// editor. The row surfaces the effective severity, or "Off", so the ruleset
	// reads at a glance without opening each one.
	private buildActiveRulesList(): SettingDefinitionList {
		return {
			type: 'list',
			heading: 'Active rules',
			search: {
				placeholder: 'Search checks',
				match: matchCheckDefinition,
			},
			items: this.plugin.activeCheckStates().map((state) => ({
				type: 'page' as const,
				name: checkLabel(state),
				desc: state.message,
				displayValue: () => this.describeCheckRow(state.slug),
				page: () => new CheckEditorPage(this, state.slug),
			})),
		};
	}

	// The library's "Your custom checks" list: create, edit, and delete. Each row
	// opens the check editor; the delete index is into this same list.
	private buildCustomCheckList(): SettingDefinitionList {
		const checks = this.plugin.customCheckList();
		return {
			type: 'list',
			heading: 'Your custom checks',
			emptyState:
				'No custom checks yet. Add one with New check, then turn it on in a group.',
			onDelete: (index: number) => {
				const check = this.plugin.customCheckList()[index];
				if (!check) {
					return;
				}
				void (async () => {
					await this.plugin.deleteCustomCheck(check.slug);
					new Notice(`Plumbline: deleted ${check.name}.`);
					this.update();
				})();
			},
			addItem: {
				name: 'New check',
				action: () => {
					void (async () => {
						await this.plugin.createCustomCheck();
						this.update();
					})();
				},
			},
			items: checks.map((check) => ({
				type: 'page' as const,
				name: check.name,
				desc: check.message,
				displayValue: () => this.describeCheckRow(check.slug),
				page: () => new CheckEditorPage(this, check.slug),
			})),
		};
	}

	// The library's built-in checks: every pack and heuristic check the active
	// group can draw from, each a tick that turns it on or off in the group. The
	// search filters by label and message. Custom checks are composed from their
	// own editor, so they are not repeated here.
	private buildBuiltinToggleList(): SettingDefinitionList {
		const builtins = this.plugin
			.libraryCheckStates()
			.filter((state) => !state.isCustom);
		return {
			type: 'list',
			heading: 'Built-in checks',
			search: {
				placeholder: 'Search checks',
				match: matchCheckDefinition,
			},
			items: builtins.map((state) => ({
				name: checkLabel(state),
				desc: state.message,
				control: {
					type: 'toggle' as const,
					key: `${LIB_KEY_PREFIX}${state.slug}`,
				},
			})),
		};
	}

	// The value shown on a check's row: its effective severity when on, or "Off".
	// Read fresh so update() reflects a change made in the editor.
	private describeCheckRow(slug: string): string {
		const state = this.plugin.checkState(slug);
		if (!state) {
			return '';
		}
		return state.enabled ? SEVERITY_LABEL[state.effectiveSeverity] : 'Off';
	}

	// Renders the version + links footer into a trailing settings row. Each
	// separator is grouped with the link after it, so a narrow sidebar wraps only
	// between whole "| Link" units, never onto a line that starts with a stray "|".
	private renderFooter(setting: Setting): void {
		const el = setting.settingEl;
		el.empty();
		el.addClass('plumbline-settings-footer');

		// One inner flex container; separators are the gap, not text whitespace.
		const inner = el.createDiv({ cls: 'plumbline-footer-inner' });
		const manifestVersion = this.plugin.manifest.version || '0.0.0';
		inner.createSpan({ text: `Version ${manifestVersion}` });

		const link = (text: string, url: string): HTMLAnchorElement => {
			const item = inner.createSpan({ cls: 'plumbline-footer-link' });
			item.createSpan({ cls: 'plumbline-footer-separator', text: '|' });
			return item.createEl('a', {
				text,
				href: url,
				attr: { target: '_blank', rel: 'noopener' },
			});
		};

		link('GitHub', 'https://github.com/ckelsoe/obsidian-plumbline');
		link('Discord', DISCORD_URL);
		link(
			'Report issues',
			'https://github.com/ckelsoe/obsidian-plumbline/issues',
		);
	}
}

// A navigable sub-page for one group: rename, choose its packs, set its roll-up
// threshold, and duplicate it. A read-only starter shows the same fields locked,
// with Duplicate as the way to get an editable copy. Deletion is the list's job
// (SettingPage has no back-navigation), so there is no delete button here.
class GroupEditorPage extends SettingPage {
	private tab: PlumblineSettingTab;
	private groupId: string;

	constructor(tab: PlumblineSettingTab, groupId: string) {
		super();
		this.tab = tab;
		this.groupId = groupId;
		this.title = this.group()?.name ?? 'Group';
	}

	private get plugin(): PlumblinePlugin {
		return this.tab.plugin;
	}

	// The group this page edits, resolved fresh so a rename or a duplicate made
	// elsewhere is reflected. Undefined if it was deleted while the page was open.
	private group(): GroupDefinition | undefined {
		return allGroups(this.plugin.groups()).find(
			(group) => group.id === this.groupId,
		);
	}

	// Rebuild the parent tab on the way out, so a rename or a new duplicate shows
	// in the list and the dropdown.
	hide(): void {
		super.hide();
		this.tab.update();
	}

	display(): void {
		const editor = this.containerEl;
		editor.empty();
		const group = this.group();
		if (!group) {
			editor.createEl('p', {
				text: 'This group no longer exists.',
			});
			return;
		}
		const readOnly = group.builtIn;

		if (readOnly) {
			new Setting(editor)
				.setName('Read-only starter')
				.setDesc(
					'Starter groups are worked examples. Duplicate this one to get an editable copy.',
				);
		}

		new Setting(editor).setName('Name').addText((text) =>
			text
				.setValue(group.name)
				.setDisabled(readOnly)
				.onChange((value) => {
					this.title = value || 'Group';
					void this.plugin.renameGroup(group.id, value);
				}),
		);

		new Setting(editor)
			.setName('Include scripture checks')
			.setDesc(
				'Verse caps, blended quotation, verbatim scripture, and the devotional-register check.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(group.extends.includes(SCRIPTURE_PACK_ID))
					.setDisabled(readOnly)
					.onChange((value) => {
						void this.plugin.setGroupScripture(group.id, value);
					}),
			);

		new Setting(editor)
			.setName('Roll up a repeated check after')
			.setDesc(
				'When one check fires more than this many times in a note, its hits collapse to a single row.',
			)
			.addDropdown((dropdown) => {
				for (let hits = 1; hits <= 8; hits++) {
					dropdown.addOption(
						String(hits),
						`${hits} hit${hits === 1 ? '' : 's'}`,
					);
				}
				dropdown
					.setValue(String(group.rollupThreshold))
					.setDisabled(readOnly)
					.onChange((value) => {
						void this.plugin.setGroupRollupThreshold(
							group.id,
							Number(value),
						);
					});
			});

		this.renderReferences(editor, group);

		new Setting(editor)
			.setName('Duplicate')
			.setDesc(
				'Make an editable copy of this group and switch to it. Go back to see it in the list.',
			)
			.addButton((button) =>
				button.setButtonText('Duplicate').onClick(() => {
					void (async () => {
						const id = await this.plugin.duplicateGroup(group.id);
						if (id) {
							new Notice(
								`Plumbline: copied ${group.name}. It is now active.`,
							);
						}
					})();
				}),
			);
	}

	// Which references this group checks against. A starter can use references
	// too: the choice is stored with the references, not on the read-only group.
	private renderReferences(
		editor: HTMLElement,
		group: GroupDefinition,
	): void {
		new Setting(editor).setName('References').setHeading();
		const references = this.plugin.references.list();
		if (references.length === 0) {
			new Setting(editor).setDesc(
				'No references yet. Add one from the main settings page, then turn it on here.',
			);
			return;
		}
		for (const reference of references) {
			const status = this.plugin.references.status(reference.id);
			new Setting(editor)
				.setName(reference.name)
				.setDesc(
					`${REFERENCE_TYPE_LABELS[reference.type]}. ${status?.message ?? ''}`.trim(),
				)
				.addToggle((toggle) => {
					toggle.toggleEl.setAttribute(
						'aria-label',
						`Use ${reference.name} in this group`,
					);
					toggle
						.setValue(
							this.plugin.references.isAssigned(
								group.id,
								reference.id,
							),
						)
						.onChange((value) => {
							void this.plugin.references.setAssigned(
								group.id,
								reference.id,
								value,
							);
						});
				});
		}
	}
}

// A navigable sub-page for one check, in the context of the active group. It shows
// the inherit/override cascade for severity, confidence, and roll-up, whether the
// check is on, and which groups it is on in. A built-in offers Duplicate to fork
// an editable copy; a custom check adds its editable definition (name, message,
// phrases) and a delete. Editing any tuning forks a read-only starter into an
// editable copy first. Reached only through a list `page` item, since the
// framework has no way to open a SettingPage from a button.
class CheckEditorPage extends SettingPage {
	private tab: PlumblineSettingTab;
	private slug: string;

	constructor(tab: PlumblineSettingTab, slug: string) {
		super();
		this.tab = tab;
		this.slug = slug;
		const state = this.state();
		this.title = state ? checkLabel(state) : 'Check';
	}

	private get plugin(): PlumblinePlugin {
		return this.tab.plugin;
	}

	private state(): CheckState | undefined {
		return this.plugin.checkState(this.slug);
	}

	// Rebuild the parent tab on the way out, so a rename, a new severity, or a
	// delete shows in the active-rules list and the library.
	hide(): void {
		super.hide();
		this.tab.update();
	}

	display(): void {
		const editor = this.containerEl;
		editor.empty();
		const state = this.state();
		if (!state) {
			editor.createEl('p', { text: 'This check no longer exists.' });
			return;
		}

		new Setting(editor)
			.setName('On in this group')
			.setDesc(
				'Whether this check runs in the active group. Editing a read-only starter makes an editable copy.',
			)
			.addToggle((toggle) => {
				toggle.toggleEl.setAttribute('aria-label', 'On in this group');
				toggle.setValue(state.enabled).onChange((value) => {
					void this.plugin.setCheckEnabled(this.slug, value);
				});
			});

		new Setting(editor)
			.setName('Severity')
			.setDesc(
				'How prominently a hit is surfaced. Error is reserved for integrity failures.',
			)
			.addDropdown((dropdown) => {
				dropdown.selectEl.setAttribute('aria-label', 'Severity');
				dropdown.addOption(
					'',
					`Default (${SEVERITY_LABEL[state.defaultSeverity]})`,
				);
				dropdown
					.addOption('error', SEVERITY_LABEL.error)
					.addOption('warning', SEVERITY_LABEL.warning)
					.addOption('suggestion', SEVERITY_LABEL.suggestion)
					.setValue(state.overrideSeverity ?? '')
					.onChange((value) => {
						void this.plugin.setRuleSeverity(
							this.slug,
							value === '' ? null : (value as Severity),
						);
					});
			});

		new Setting(editor)
			.setName('Confidence')
			.setDesc(
				'How much this check is trusted when it fires, which weighs it in the findings ranking.',
			)
			.addDropdown((dropdown) => {
				dropdown.selectEl.setAttribute('aria-label', 'Confidence');
				dropdown.addOption(
					'',
					`Default (${Math.round(state.defaultConfidence * 100)}%)`,
				);
				for (let pct = 10; pct <= 100; pct += 10) {
					dropdown.addOption(String(pct), `${pct}%`);
				}
				dropdown
					.setValue(
						state.overrideConfidence === null
							? ''
							: String(
									Math.round(state.overrideConfidence * 100),
								),
					)
					.onChange((value) => {
						void this.plugin.setRuleConfidence(
							this.slug,
							value === '' ? null : Number(value) / 100,
						);
					});
			});

		new Setting(editor)
			.setName('Roll up a repeated check after')
			.setDesc(
				'Collapse this check to one row past this many hits in a note. Default follows the group.',
			)
			.addDropdown((dropdown) => {
				dropdown.selectEl.setAttribute(
					'aria-label',
					'Roll up a repeated check after',
				);
				dropdown.addOption(
					'',
					`Group default (${state.groupRollupThreshold})`,
				);
				for (let hits = 1; hits <= 8; hits++) {
					dropdown.addOption(
						String(hits),
						`${hits} hit${hits === 1 ? '' : 's'}`,
					);
				}
				dropdown
					.setValue(
						state.overrideRollup === null
							? ''
							: String(state.overrideRollup),
					)
					.onChange((value) => {
						void this.plugin.setRuleRollup(
							this.slug,
							value === '' ? null : Number(value),
						);
					});
			});

		const groups = this.plugin.inGroupNames(this.slug);
		new Setting(editor)
			.setName('In groups')
			.setDesc(
				groups.length > 0
					? groups.join(', ')
					: 'Not on in any group yet.',
			);

		if (state.isCustom) {
			this.renderCustomDefinition(editor, state);
		}

		// Duplicate is the way to fork a locked built-in phrase rule into an
		// editable copy. A custom check is already editable (and has Delete), so it
		// is not offered there; a heuristic has no phrase list to fork.
		if (!state.isHeuristic && !state.isCustom) {
			new Setting(editor)
				.setName('Duplicate')
				.setDesc(
					'Make an editable copy in your custom checks, so you can change its wording and phrases.',
				)
				.addButton((button) => {
					button.buttonEl.setAttribute(
						'aria-label',
						`Duplicate ${checkLabel(state)}`,
					);
					button.setButtonText('Duplicate').onClick(() => {
						void (async () => {
							const id = await this.plugin.duplicateCheckToCustom(
								this.slug,
							);
							if (id) {
								new Notice(
									`Plumbline: copied ${checkLabel(state)}.`,
								);
								this.tab.update();
							}
						})();
					});
				});
		}
	}

	// The editable definition of a custom check: its name, the message shown on a
	// finding, the phrases it matches, and a delete. A built-in's matching is
	// locked, so this section is custom-only.
	private renderCustomDefinition(
		editor: HTMLElement,
		state: CheckState,
	): void {
		const check = this.plugin
			.customCheckList()
			.find((entry) => entry.slug === this.slug);
		if (!check) {
			return;
		}

		new Setting(editor).setName('Name').addText((text) => {
			text.inputEl.setAttribute('aria-label', 'Check name');
			text.setValue(check.name).onChange((value) => {
				this.title = value || 'Check';
				void this.plugin.updateCustomCheck(this.slug, { name: value });
			});
		});

		new Setting(editor)
			.setName('Message')
			.setDesc('Shown on every finding this check makes.')
			.addText((text) => {
				text.inputEl.setAttribute('aria-label', 'Finding message');
				text.setValue(check.message).onChange((value) => {
					void this.plugin.updateCustomCheck(this.slug, {
						message: value,
					});
				});
			});

		new Setting(editor)
			.setName('Phrases')
			.setDesc(
				'One phrase per line, matched whole-word and case-insensitively, outside code and quoted spans.',
			)
			.setClass('plumbline-stacked-row')
			.addTextArea((area) => {
				area.inputEl.setAttribute(
					'aria-label',
					'Phrases, one per line',
				);
				area.setValue(check.phrases.join('\n'))
					.setPlaceholder('One phrase per line')
					.onChange((value) => {
						void this.plugin.updateCustomCheck(this.slug, {
							phrases: splitPhrases(value),
						});
					});
			});

		new Setting(editor)
			.setName('Delete this check')
			.setDesc(
				'Remove it from the library and from every group. This cannot be undone.',
			)
			.addButton((button) => {
				button.buttonEl.setAttribute(
					'aria-label',
					`Delete ${checkLabel(state)}`,
				);
				button
					.setButtonText('Delete')
					.setDestructive()
					.onClick(() => {
						void (async () => {
							await this.plugin.deleteCustomCheck(this.slug);
							new Notice(
								`Plumbline: deleted ${checkLabel(state)}.`,
							);
							this.display();
						})();
					});
			});
	}
}

// What each reference type is for and the format it reads, shown under the
// type picker in the reference editor.
const TYPE_HELP: Record<ReferenceType, string> = {
	'quote-source':
		'Plumbline checks quoted verses against it. Inside the folder: one folder per translation (named by its code, such as KJV), then one folder per book named like "19 - Psalms", holding one note per chapter named like "Psalms 23", with each verse ending in a block ID like ^v1. The README has a full example.',
	'source-notes':
		'A folder of notes that quotes cite, such as interview transcripts, statutes, or source documents. Cite a note with a wikilink straight after a quote, like "we shipped late" ([[2024-03-02 Interview]]), or in a footnote. Plumbline flags a quote that is not in the note it cites. The README has a full example.',
	'name-list':
		'A folder of notes about the people and places in your story, one note each, titled with the name. Aliases in a note\'s frontmatter count as names too. Plumbline flags a capitalised word that is one letter off a name (two for names of eight or more letters), such as "Katherine" for "Catherine", and offers the name. Names under four letters are not checked. The README has a full example.',
	'term-list':
		'A note of terms to avoid, flagged in every note the group checks. Use a table with a column such as "Do not use" or "Avoid" and, if you like, one such as "Use instead" for the replacement, or bullets that open with a quoted phrase. A brand voice file in this format works as it is. The README has a full example.',
};

// A navigable sub-page for one reference: its name, its folder, and the result of
// the setup validation, which runs as soon as a folder is chosen. Reached through
// the References list, since the framework cannot open a SettingPage otherwise.
class ReferenceEditorPage extends SettingPage {
	private tab: PlumblineSettingTab;
	private id: string;
	private statusSetting: Setting | null = null;

	constructor(tab: PlumblineSettingTab, id: string) {
		super();
		this.tab = tab;
		this.id = id;
		this.title = this.reference()?.name ?? 'Reference';
	}

	private get plugin(): PlumblinePlugin {
		return this.tab.plugin;
	}

	private reference(): Reference | undefined {
		return this.plugin.references.get(this.id);
	}

	hide(): void {
		super.hide();
		this.tab.update();
	}

	display(): void {
		const editor = this.containerEl;
		editor.empty();
		const reference = this.reference();
		if (!reference) {
			editor.createEl('p', { text: 'This reference no longer exists.' });
			return;
		}

		new Setting(editor).setName('Name').addText((text) => {
			text.inputEl.setAttribute('aria-label', 'Reference name');
			text.setValue(reference.name).onChange((value) => {
				const name = value.trim();
				if (name.length === 0) {
					return;
				}
				this.title = name;
				void this.plugin.references.rename(this.id, name);
			});
		});

		new Setting(editor)
			.setName('Type')
			.setDesc(TYPE_HELP[reference.type])
			.addDropdown((dropdown) => {
				dropdown.selectEl.setAttribute('aria-label', 'Reference type');
				for (const [type, label] of Object.entries(
					REFERENCE_TYPE_LABELS,
				)) {
					dropdown.addOption(type, label);
				}
				dropdown.setValue(reference.type).onChange((value) => {
					void (async () => {
						await this.plugin.references.setType(
							this.id,
							value as ReferenceType,
						);
						// The path field switches between a folder and a note.
						this.display();
					})();
				});
			});

		const isFile = referenceTargetsFile(reference.type);
		new Setting(editor)
			.setName(isFile ? 'Note' : 'Folder')
			.setDesc(
				isFile
					? 'Start typing to pick a note in this vault.'
					: 'Start typing to pick a folder in this vault.',
			)
			.addText((text) => {
				text.inputEl.setAttribute(
					'aria-label',
					isFile ? 'Reference note' : 'Reference folder',
				);
				text.setPlaceholder(
					isFile
						? 'Example: Style/Voice.md'
						: reference.type === 'source-notes'
							? 'Example: Interviews'
							: reference.type === 'name-list'
								? 'Example: Characters'
								: 'Example: Bible',
				).setValue(reference.path);
				const commit = (path: string): void => {
					void this.commitPath(path);
				};
				new PathSuggest(
					this.plugin.app,
					text.inputEl,
					isFile ? 'note' : 'folder',
					commit,
				);
				// A typed path is committed when the field loses focus; a picked
				// suggestion commits at once. Either way it is validated then.
				text.inputEl.addEventListener('change', () => {
					commit(text.getValue());
				});
			});

		this.statusSetting = new Setting(editor).setName('Check');
		this.renderStatus();

		const users = this.plugin.references
			.groupIdsUsing(this.id)
			.map(
				(id) =>
					allGroups(this.plugin.groups()).find((g) => g.id === id)
						?.name ?? id,
			);
		new Setting(editor)
			.setName('Used by')
			.setDesc(
				users.length > 0
					? users.join(', ')
					: "No group yet. Turn it on in a group's editor under Manage groups.",
			);
	}

	private async commitPath(path: string): Promise<void> {
		if (this.statusSetting) {
			this.statusSetting.setDesc('Checking...');
		}
		await this.plugin.references.setPath(this.id, path);
		this.renderStatus();
	}

	private renderStatus(): void {
		const setting = this.statusSetting;
		if (!setting) {
			return;
		}
		const status = this.plugin.references.status(this.id);
		setting.setDesc(status?.message ?? 'Checking...');
		setting.settingEl.toggleClass(
			'plumbline-reference-ok',
			status?.state === 'ok',
		);
		setting.settingEl.toggleClass(
			'plumbline-reference-problem',
			status !== undefined && status.state !== 'ok',
		);
	}
}
