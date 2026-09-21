import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	SettingDefinitionList,
	SettingPage,
} from 'obsidian';
import type PlumblinePlugin from './main';
import type { RuleState } from './main';
import { allGroups } from './engine/group-store';
import type { GroupDefinition } from './engine/groups';
import { SCRIPTURE_PACK_ID } from './engine/scripture';
import type { Severity } from './engine/types';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite. A discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';

// The comment-span toggles are keyed with this prefix so getControlValue and
// setControlValue can route them to the vault config instead of plugin settings.
// The rule rows are rendered imperatively (renderRuleRow) and write to the active
// group's membership, so they need no such key. The roll-up control uses the plain
// 'rollup' key, routed to the active group.
const SPAN_KEY_PREFIX = 'span:';
const ROLLUP_KEY = 'rollup';

// Turn a rule slug into a readable, sentence-case label ('reader-direction' ->
// 'Reader direction') for the settings list.
function prettifySlug(slug: string): string {
	const spaced = slug.replace(/-/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
			{
				type: 'group',
				heading: 'Active rules',
				items: this.plugin.profileRuleStates().map((state) => ({
					name: prettifySlug(state.slug),
					searchable: false,
					render: (setting: Setting) => {
						this.renderRuleRow(setting, state);
					},
				})),
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
	// config's disabled-span set; the roll-up key routes to the active group; every
	// other key is a plugin setting. Rule rows are rendered (renderRuleRow), not
	// declarative controls, so they do not pass through here.
	getControlValue(key: string): unknown {
		if (key.startsWith(SPAN_KEY_PREFIX)) {
			const kind = key.slice(SPAN_KEY_PREFIX.length);
			return this.plugin
				.commentSpanStates()
				.some((state) => state.kind === kind && state.enabled);
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
	// so the dropdown and the rule rows below would otherwise show the old group
	// until the tab was reopened.
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

	// One rule row: name and message, a severity dropdown, and an on/off toggle,
	// both writing to the active group's membership (forking a read-only starter
	// first). Choosing a rule's own default severity clears the override rather
	// than storing a no-op entry.
	private renderRuleRow(setting: Setting, state: RuleState): void {
		setting.setName(prettifySlug(state.slug)).setDesc(state.message);
		setting.addDropdown((dropdown) => {
			dropdown
				.addOption('error', 'Error')
				.addOption('warning', 'Warning')
				.addOption('suggestion', 'Suggestion')
				.setValue(state.severity)
				.onChange((value) => {
					const severity = value as Severity;
					void this.withActiveGroupRerender(() =>
						this.plugin.setRuleSeverity(
							state.slug,
							severity === state.defaultSeverity
								? null
								: severity,
						),
					);
				});
		});
		setting.addToggle((toggle) => {
			toggle.setValue(state.enabled).onChange((value) => {
				void this.withActiveGroupRerender(() =>
					this.plugin.setRuleEnabled(state.slug, value),
				);
			});
		});
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
}
