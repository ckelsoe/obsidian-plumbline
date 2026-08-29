import { Extension, Range } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view';
import { lint } from './engine/lint';
import { ResolvedConfig, Severity } from './engine/types';

function markFor(severity: Severity, message: string): Decoration {
	return Decoration.mark({
		class: `plumbline-flag plumbline-flag-${severity}`,
		attributes: { title: message },
	});
}

function buildDecorations(
	view: EditorView,
	config: ResolvedConfig,
): DecorationSet {
	const result = lint(view.state.doc.toString(), config);
	const docLength = view.state.doc.length;
	const ranges: Range<Decoration>[] = [];
	for (const d of result.diagnostics) {
		if (d.end > d.start && d.end <= docLength) {
			ranges.push(markFor(d.severity, d.message).range(d.start, d.end));
		}
	}
	// Decoration.set sorts and tolerates overlapping marks, unlike RangeSetBuilder.
	return Decoration.set(ranges, true);
}

// A CodeMirror view plugin that underlines every flagged phrase in the active
// editor and shows the rule message on hover. It rebuilds when the document
// changes; `getConfig` is read on each build so the active profile and any vault
// overrides are current.
export function plumblineDecorations(
	getConfig: () => ResolvedConfig,
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, getConfig());
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) {
					this.decorations = buildDecorations(
						update.view,
						getConfig(),
					);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
