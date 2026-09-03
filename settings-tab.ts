import {
	App,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
} from 'obsidian';
import type PlumblinePlugin from './main';

// Community discussion for this plugin. This must stay a never-expiring
// discord.gg invite. A discord.com/channels/... deep link only resolves for
// accounts already in the server, so it cannot get anyone in, and a default
// invite expires after 7 days and would rot in a shipped release.
const DISCORD_URL = 'https://discord.gg/gd6tKJDPj4';

// Control keys for the per-rule toggles are namespaced so getControlValue and
// setControlValue can route them to the vault config instead of plugin settings.
const RULE_KEY_PREFIX = 'rule:';

// Built-in writing profiles. Each selects which rule packs are active and how
// they are tuned. The full cascade lives in the project's dev docs; only the
// scripture profile is implemented today.
const PROFILE_OPTIONS: Record<string, string> = {
	'scripture-book': 'Scripture-first book',
};

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
				heading: 'Writing profile',
				items: [
					{
						name: 'Active profile',
						desc: 'The type of writing to lint for. The profile selects which rule packs are on and how they are tuned.',
						control: {
							type: 'dropdown',
							key: 'activeProfile',
							options: PROFILE_OPTIONS,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Active rules',
				items: this.plugin.profileRuleStates().map((state) => ({
					name: prettifySlug(state.slug),
					desc: state.message,
					control: {
						type: 'toggle' as const,
						key: `${RULE_KEY_PREFIX}${state.slug}`,
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

	// Binds declarative control definitions to their store. A `rule:` key reads
	// from the vault config's disabled set; every other key is a plugin setting.
	getControlValue(key: string): unknown {
		if (key.startsWith(RULE_KEY_PREFIX)) {
			const slug = key.slice(RULE_KEY_PREFIX.length);
			return this.plugin
				.profileRuleStates()
				.some((state) => state.slug === slug && state.enabled);
		}
		return (this.plugin.settings as unknown as Record<string, unknown>)[
			key
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(RULE_KEY_PREFIX)) {
			const slug = key.slice(RULE_KEY_PREFIX.length);
			await this.plugin.setRuleEnabled(slug, Boolean(value));
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
