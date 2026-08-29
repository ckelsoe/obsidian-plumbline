import { MarkdownView } from 'obsidian';
import { lint } from './engine/lint';
import { resolveConfig } from './engine/config';
import { LintResult } from './engine/types';
import type PlumblinePlugin from './main';

// The one place that reaches into Obsidian to fetch editor text and run the
// engine. Keeping this separate from the plugin class keeps main.ts to wiring
// and keeps the engine and formatting pure and testable.
export class AnalysisService {
	constructor(private readonly plugin: PlumblinePlugin) {}

	// Analyze the active markdown note. Returns null when no markdown editor is
	// focused (a non-editor pane, or an empty workspace).
	analyzeActiveNote(): LintResult | null {
		const view =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return null;
		}
		const config = resolveConfig(this.plugin.settings.activeProfile);
		return lint(view.editor.getValue(), config);
	}
}
