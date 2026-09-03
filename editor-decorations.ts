import { Extension, Range, StateEffect } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view';
import {
	Diagnostic as CmDiagnostic,
	forceLinting,
	linter,
	lintGutter,
} from '@codemirror/lint';
import { lint } from './engine/lint';
import { ResolvedConfig, Severity } from './engine/types';
import { assignLayers } from './underline-layers';

// Dispatched to an editor when the plugin config changes (profile switch, rule
// toggle, config reload). The linter watches for it through `needsRefresh`, and
// the underline layer watches for it in `update`, so both re-run against the new
// config, which `forceLinting` alone cannot do once the initial lint has settled.
const configChanged = StateEffect.define<null>();

// Underlines stack up to this many rows. A finding assigned a deeper layer draws
// on the top row; its message is still in the hover tooltip and the flags panel.
const MAX_UNDERLINE_LAYERS = 3;

// Map the engine's severities onto CodeMirror's. 'suggestion' has no exact CM
// equivalent, so it uses 'info', the lowest-urgency mark CM styles.
function cmSeverity(severity: Severity): CmDiagnostic['severity'] {
	if (severity === 'error') {
		return 'error';
	}
	if (severity === 'warning') {
		return 'warning';
	}
	return 'info';
}

// A short, human label for the severity, shown as a colored tag in the tooltip so
// a reader can tell the issue types apart when several stack on the same text.
function severityLabel(severity: Severity): string {
	if (severity === 'error') {
		return 'Error';
	}
	if (severity === 'warning') {
		return 'Warning';
	}
	return 'Suggestion';
}

// Build the tooltip content for one finding: a colored severity tag and the rule
// message, in place of CodeMirror's plain unlabeled text. When several findings
// share a range CodeMirror stacks these, so each is labeled and readable.
function renderFinding(severity: Severity, message: string): HTMLElement {
	const el = createDiv({ cls: 'plumbline-lint-item' });
	el.createSpan({
		cls: `plumbline-lint-tag plumbline-lint-tag-${severity}`,
		text: severityLabel(severity),
	});
	el.createSpan({ cls: 'plumbline-lint-text', text: message });
	return el;
}

// Debounce for live re-linting while typing, matched to the plugin's refresh.
const LINT_DELAY = 400;

// The visible underlines: one per finding, stacked by layer so overlapping
// findings read as separate lines (a spot with two issues shows two lines) rather
// than one flat mark. Drawn with a background gradient, which has no layout
// effect, so nested overlapping marks stack cleanly instead of shifting the text.
function buildUnderlines(
	view: EditorView,
	getConfig: () => ResolvedConfig,
): DecorationSet {
	const result = lint(view.state.doc.toString(), getConfig());
	const docLength = view.state.doc.length;
	const inRange = result.diagnostics.filter(
		(d) => d.end > d.start && d.end <= docLength,
	);
	const ranges: Range<Decoration>[] = [];
	for (const { diagnostic, layer } of assignLayers(inRange)) {
		const row = Math.min(layer, MAX_UNDERLINE_LAYERS - 1);
		ranges.push(
			Decoration.mark({
				class: `plumbline-ul plumbline-ul-${diagnostic.severity} plumbline-ul-l${row}`,
			}).range(diagnostic.start, diagnostic.end),
		);
	}
	return Decoration.set(ranges, true);
}

function underlineLayer(getConfig: () => ResolvedConfig): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildUnderlines(view, getConfig);
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.transactions.some((tr) =>
						tr.effects.some((effect) => effect.is(configChanged)),
					)
				) {
					this.decorations = buildUnderlines(update.view, getConfig);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

// Run the engine through CodeMirror's lint system for the hover tooltip and gutter
// marker, and draw the visible underlines as a separate stacked layer. The linter
// keeps its own range mark (hidden in styles.css) only so the tooltip has a target
// to hover. `getConfig` is read on each run so the active profile and any vault
// overrides are current.
export function plumblineDecorations(
	getConfig: () => ResolvedConfig,
): Extension {
	const source = (view: EditorView): CmDiagnostic[] => {
		const result = lint(view.state.doc.toString(), getConfig());
		const docLength = view.state.doc.length;
		const diagnostics: CmDiagnostic[] = [];
		for (const d of result.diagnostics) {
			if (d.end > d.start && d.end <= docLength) {
				const severity = d.severity;
				const message = d.message;
				diagnostics.push({
					from: d.start,
					to: d.end,
					severity: cmSeverity(severity),
					message,
					// The mark is hidden; the visible underline is the stacked layer.
					// This class only gives styles.css a hook to hide CodeMirror's
					// default wavy mark for this plugin's ranges.
					markClass: 'plumbline-flag',
					// Render a labeled, readable message instead of CodeMirror's
					// plain unlabeled text.
					renderMessage: () => renderFinding(severity, message),
				});
			}
		}
		return diagnostics;
	};
	const needsRefresh = (update: ViewUpdate): boolean =>
		update.transactions.some((tr) =>
			tr.effects.some((effect) => effect.is(configChanged)),
		);
	return [
		linter(source, { delay: LINT_DELAY, needsRefresh }),
		lintGutter(),
		underlineLayer(getConfig),
	];
}

// Re-run the linter and underlines now, without waiting for the next edit. Called
// when the config changes (profile switch, rule toggle, config reload) so the
// editor updates at once rather than on the next keystroke. The dispatched effect
// makes the linter treat the config as changed (via needsRefresh) and drives the
// underline layer's update; forceLinting then runs the linter pass immediately.
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
	forceLinting(view);
}
