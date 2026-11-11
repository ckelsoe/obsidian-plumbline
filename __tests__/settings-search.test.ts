// Obsidian's settings search finds a setting by its name, description and
// aliases. A section drawn by hand has none of those unless it is given them,
// so every one of them except the footer must carry a name and be searchable.
// Plumbline's tab is declarative apart from the footer; this pins that.

import type { App } from 'obsidian';
import type PlumblinePlugin from '../main';
import { PlumblineSettingTab } from '../settings-tab';

// The tab module extends Obsidian classes at load time, and the obsidian
// package ships types only, so the classes it touches are stubbed here.
// Vitest hoists this above the imports.
vi.mock('obsidian', () => {
	class Stub {}
	return {
		AbstractInputSuggest: Stub,
		Notice: Stub,
		PluginSettingTab: Stub,
		Setting: Stub,
		SettingPage: Stub,
		TFile: Stub,
		TFolder: Stub,
	};
});

interface Item {
	type?: string;
	name?: string;
	desc?: unknown;
	searchable?: boolean;
	render?: unknown;
	items?: Item[];
}

function leaves(items: Item[]): Item[] {
	return items.flatMap((i) => (i.items ? leaves(i.items) : [i]));
}

describe('settings search', () => {
	const plugin = {
		groups: () => [],
		commentSpanStates: () => [],
		activeCheckStates: () => [],
		libraryCheckStates: () => [],
		customCheckList: () => [],
		references: { list: () => [] },
	} as unknown as PlumblinePlugin;
	const tab = new PlumblineSettingTab({} as App, plugin);
	const items = leaves(tab.getSettingDefinitions() as unknown as Item[]);
	const custom = items.filter((i) => i.render !== undefined && !i.type);

	it('draws nothing by hand except the footer, which stays out of search', () => {
		expect(custom).toHaveLength(1);
		expect(custom[0]?.searchable).toBe(false);
	});

	it('gives every other setting a name and a string description', () => {
		for (const i of items.filter((c) => c.searchable !== false)) {
			expect(typeof i.name).toBe('string');
			expect(i.name).not.toBe('');
			expect(typeof i.desc).toBe('string');
		}
	});

	it('finds the settings people look for by name', () => {
		const names = items.map((i) => i.name);
		for (const n of [
			'Active group',
			'Roll up a repeated check after',
			'Underline flagged phrases',
			'Pause length in minutes',
		])
			expect(names).toContain(n);
	});
});
