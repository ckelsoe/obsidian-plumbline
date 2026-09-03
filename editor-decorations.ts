import { Extension, StateEffect } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import {
	Diagnostic as CmDiagnostic,
	forceLinting,
	linter,
	lintGutter,
} from '@codemirror/lint';
import { lint } from './engine/lint';
import { ResolvedConfig, Severity } from './engine/types';

// Dispatched to an editor when the plugin config changes (profile switch, rule
// toggle, config reload). The linter watches for it through `needsRefresh` so the
// underlines re-run against the new config, which `forceLinting` alone cannot do
// once the initial lint has settled.
const configChanged = StateEffect.define<null>();

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

// Debounce for live re-linting while typing, matched to the plugin's refresh.
const LINT_DELAY = 400;

// Run the engine through CodeMirror's lint system. Unlike a bare decoration with
// a `title` attribute, this gives a real hover tooltip carrying the rule message,
// a gutter marker per flagged line, and CM's own underline styling, so a flag is
// discoverable instead of a silent squiggle. `getConfig` is read on each run so
// the active profile and any vault overrides are current.
export function plumblineDecorations(
	getConfig: () => ResolvedConfig,
): Extension {
	const source = (view: EditorView): CmDiagnostic[] => {
		const result = lint(view.state.doc.toString(), getConfig());
		const docLength = view.state.doc.length;
		const diagnostics: CmDiagnostic[] = [];
		for (const d of result.diagnostics) {
			if (d.end > d.start && d.end <= docLength) {
				diagnostics.push({
					from: d.start,
					to: d.end,
					severity: cmSeverity(d.severity),
					message: d.message,
					source: 'Plumbline',
				});
			}
		}
		return diagnostics;
	};
	const needsRefresh = (update: ViewUpdate): boolean =>
		update.transactions.some((tr) =>
			tr.effects.some((effect) => effect.is(configChanged)),
		);
	return [linter(source, { delay: LINT_DELAY, needsRefresh }), lintGutter()];
}

// Re-run the linter now, without waiting for the next edit. Called when the
// config changes (profile switch, rule toggle, config reload) so the editor
// underlines update at once rather than on the next keystroke. The dispatched
// effect makes the linter treat the config as changed (via needsRefresh);
// forceLinting then runs that scheduled pass immediately.
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
	forceLinting(view);
}
