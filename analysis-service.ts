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

	// The active markdown note, or null when a non-editor pane is focused.
	activeMarkdownView(): MarkdownView | null {
		return this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
	}

	// Run the engine against a specific markdown view.
	analyze(view: MarkdownView): LintResult {
		const config = resolveConfig(this.plugin.settings.activeProfile);
		return lint(view.editor.getValue(), config);
	}

	// Convenience for callers that only need the active note (the rhythm command).
	analyzeActiveNote(): LintResult | null {
		const view = this.activeMarkdownView();
		return view ? this.analyze(view) : null;
	}
}
