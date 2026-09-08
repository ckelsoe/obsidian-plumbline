// Local type augmentations for the Obsidian API.
// Add type declarations here when the Obsidian types are missing or need extension.
// NEVER use `as any` to work around missing types. Add a proper declaration here instead.

import 'obsidian';
import type { EditorView } from '@codemirror/view';

declare global {
	// Obsidian installs createEl / createDiv / createSpan on every window, but
	// obsidian.d.ts declares them only as globals and on Node, never as members
	// of the DOM Window interface. eslint-plugin-obsidianmd 0.4.x's
	// prefer-create-el rule asks you to replace `doc.createElement(...)` with
	// `doc.win.createEl(...)` or `activeWindow.createDiv()`; without these
	// declarations that form resolves as `any` and cascades into no-unsafe-*
	// errors. Keep this block if the plugin builds detached elements.
	interface Window {
		createEl<K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void,
		): HTMLElementTagNameMap[K];
		createDiv(
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void,
		): HTMLDivElement;
		createSpan(
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void,
		): HTMLSpanElement;
	}
}

declare module 'obsidian' {
	interface PluginManifest {
		version: string;
	}

	// Obsidian's Editor wraps a CodeMirror 6 EditorView and exposes it as `cm`.
	// obsidian.d.ts does not declare it, but it is the only supported handle for
	// forcing the lint extension to re-run after a config change. Declared here
	// rather than reached with an `as any`.
	interface Editor {
		cm: EditorView;
	}

	// The plugin registry. obsidian.d.ts does not declare it, and it is the
	// supported way to reach a sibling plugin's API at call time, which is what
	// interop-contract 4.5 requires: resolve on every use, never hold a handle
	// across the other plugin's reload. Typed as `unknown` on purpose, because
	// the neighbour's shape is its business and this side must narrow it.
	interface App {
		plugins: {
			getPlugin(id: string): unknown;
		};
	}
}
