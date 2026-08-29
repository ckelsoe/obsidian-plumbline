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

// Built-in writing profiles. Each selects which rule packs are active and how
// they are tuned. The full cascade lives in the project's dev docs; only the
// scripture profile is implemented today.
const PROFILE_OPTIONS: Record<string, string> = {
	'scripture-book': 'Scripture-first book',
};

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
				name: '',
				searchable: false,
				render: (setting: Setting) => {
					this.renderFooter(setting);
				},
			},
		];
	}

	// Binds declarative control definitions to the plugin's own settings store,
	// so a change persists through saveSettings().
	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[
			key
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			value;
		await this.plugin.saveSettings();
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
