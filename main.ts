import { Notice, Plugin } from 'obsidian';
import { PlumblineSettingTab } from './settings-tab';
import { AnalysisService } from './analysis-service';
import { rhythmStatusText, rhythmDetail } from './rhythm-format';

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
	private statusBar: HTMLElement | null = null;
	private refreshTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new PlumblineSettingTab(this.app, this));

		// Switching notes recomputes at once; typing recomputes debounced.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refreshStatus();
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

		this.app.workspace.onLayoutReady(() => {
			this.refreshStatus();
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

	private scheduleRefresh(): void {
		this.clearRefreshTimer();
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshStatus();
		}, REFRESH_DELAY);
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	// Recompute the active note's rhythm and show it in the status bar. Cleared
	// when no markdown note is focused.
	private refreshStatus(): void {
		if (!this.statusBar) {
			return;
		}
		const result = this.analysis.analyzeActiveNote();
		this.statusBar.setText(result ? rhythmStatusText(result) : '');
	}

	private showRhythmNotice(): void {
		const result = this.analysis.analyzeActiveNote();
		if (!result) {
			new Notice('Plumbline: open a note to see its prose rhythm.');
			return;
		}
		new Notice(rhythmDetail(result));
	}
}
