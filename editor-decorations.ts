import { EditorState, Extension, Range, StateEffect } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	Tooltip,
	ViewPlugin,
	ViewUpdate,
	hoverTooltip,
} from '@codemirror/view';
import {
	Diagnostic as CmDiagnostic,
	forEachDiagnostic,
	forceLinting,
	linter,
	lintGutter,
	setDiagnosticsEffect,
} from '@codemirror/lint';
import { lint } from './engine/lint';
import { Diagnostic, ResolvedConfig, Severity } from './engine/types';
import { coverageSegments } from './underline-coverage';
import { summarizeSeverities } from './gutter-summary';

// Dispatched to an editor when the plugin config changes (profile switch, rule
// toggle, config reload). The linter watches for it through `needsRefresh`, which
// `forceLinting` alone cannot do once the initial lint has settled.
const configChanged = StateEffect.define<null>();

// Debounce for the engine pass while typing. Every surface reads the result of
// this one call, so it is the only place the engine runs.
const LINT_DELAY = 400;

// How long the pointer must rest on a finding before its popup appears.
const HOVER_TIME = 200;

// A CodeMirror diagnostic carrying the engine finding it came from. CodeMirror
// stores these objects as given and hands them back through forEachDiagnostic,
// so the severity and rule message survive the round trip without a parallel map
// keyed on position.
interface PlumblineDiagnostic extends CmDiagnostic {
	plumbline: Diagnostic;
}

function isPlumblineDiagnostic(d: CmDiagnostic): d is PlumblineDiagnostic {
	return 'plumbline' in d;
}

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

// A short, human label for the severity, shown as a colored tag in the popup so a
// reader can tell the issue types apart when several cover the same text.
function severityLabel(severity: Severity): string {
	if (severity === 'error') {
		return 'Error';
	}
	if (severity === 'warning') {
		return 'Warning';
	}
	return 'Suggestion';
}

// One finding row for the popup: a colored severity tag and the rule message.
function renderFinding(diagnostic: Diagnostic): HTMLElement {
	const el = createDiv({ cls: 'plumbline-hover-item' });
	el.createSpan({
		cls: `plumbline-hover-tag plumbline-hover-tag-${diagnostic.severity}`,
		text: severityLabel(diagnostic.severity),
	});
	el.createSpan({ cls: 'plumbline-hover-text', text: diagnostic.message });
	return el;
}

// The gutter tooltip: one summary line rather than a list of every finding on the
// paragraph. The counting and wording live in gutter-summary.ts so they can be
// tested without CodeMirror; the reasoning is recorded there.
//
// A single finding is returned as itself, because a count of one tells the reader
// nothing they cannot already see.
//
// The bar's COLOUR is unaffected by this filter: CodeMirror computes it with
// maxSeverity over the unfiltered set when it builds the marker.
function gutterTooltip(diagnostics: readonly CmDiagnostic[]): CmDiagnostic {
	const first = diagnostics[0];
	if (diagnostics.length === 1 && first) {
		return first;
	}
	const severities = diagnostics.map((d) =>
		isPlumblineDiagnostic(d) ? d.plumbline.severity : 'suggestion',
	);
	const summary = summarizeSeverities(severities);
	return {
		from: first?.from ?? 0,
		to: first?.to ?? 0,
		severity: cmSeverity(summary.severity),
		message: summary.message,
	};
}

// The findings CodeMirror currently holds, at their CURRENT positions.
//
// Reading the lint state rather than calling the engine is the point of this
// function. The engine runs once per debounce interval, in the linter source
// below, and the underlines, the hover and the gutter all read what it produced.
// Before this, the underline layer ran a full-document lint() on every keystroke
// and the hover ran another on every hover.
//
// The positions come from the callback, not from `d.plumbline`. CodeMirror maps
// its diagnostic ranges through every edit, so between a keystroke and the next
// debounced pass the mapped range still covers the right words while the offsets
// the engine computed are stale.
function currentFindings(state: EditorState): Diagnostic[] {
	const out: Diagnostic[] = [];
	forEachDiagnostic(state, (d, from, to) => {
		if (isPlumblineDiagnostic(d) && to > from) {
			out.push({ ...d.plumbline, start: from, end: to });
		}
	});
	return out;
}

// The visible underlines: one line per coverage segment, colored by the worst
// severity covering it, and drawn as a double underline where two or more findings
// overlap so a denser spot is visibly different from a single-issue one. Segments
// never overlap, so each is one clean mark.
function buildUnderlines(view: EditorView): DecorationSet {
	const docLength = view.state.doc.length;
	const inRange = currentFindings(view.state).filter(
		(d) => d.end > d.start && d.end <= docLength,
	);
	const ranges: Range<Decoration>[] = [];
	for (const seg of coverageSegments(inRange)) {
		const multi = seg.count >= 2 ? ' plumbline-mark-multi' : '';
		ranges.push(
			Decoration.mark({
				class: `plumbline-mark plumbline-mark-${seg.severity}${multi}`,
			}).range(seg.start, seg.end),
		);
	}
	return Decoration.set(ranges, true);
}

function segmentUnderlines(): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildUnderlines(view);
			}

			update(update: ViewUpdate): void {
				// Rebuilt on docChanged as well as on a new lint result, so the
				// marks track the text while typing instead of sitting at stale
				// offsets until the debounce elapses. This is cheap now: it walks
				// the existing diagnostic range set and runs no rules.
				if (
					update.docChanged ||
					update.transactions.some((tr) =>
						tr.effects.some((effect) =>
							effect.is(setDiagnosticsEffect),
						),
					)
				) {
					this.decorations = buildUnderlines(update.view);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

// The hover popup, on the underlined word. A tooltip this plugin owns rather than
// CodeMirror's lint hover, which dismissed itself the instant it appeared because
// its `hideOn` fires on any change. `tooltipFilter` below keeps the lint hover
// from competing with this one for the same pointer.
function findingsHover(): Extension {
	return hoverTooltip(
		(view, pos): Tooltip | null => {
			const covering = currentFindings(view.state).filter(
				(d) => pos >= d.start && pos <= d.end,
			);
			if (covering.length === 0) {
				return null;
			}
			let start = covering[0]?.start ?? pos;
			let end = covering[0]?.end ?? pos;
			for (const d of covering) {
				start = Math.min(start, d.start);
				end = Math.max(end, d.end);
			}
			return {
				pos: start,
				end,
				above: false,
				create() {
					const dom = createDiv({ cls: 'plumbline-hover' });
					for (const d of covering) {
						dom.appendChild(renderFinding(d));
					}
					return { dom };
				},
			};
		},
		{ hoverTime: HOVER_TIME, hideOnChange: false },
	);
}

// The editor integration. One debounced engine pass feeds three surfaces: the
// coverage underlines, the hover popup, and the per-paragraph gutter bar.
//
// `markerFilter` is deliberately NOT used to hide CodeMirror's own inline marks,
// even though that reads like the obvious lever. LintState.init applies
// markerFilter BEFORE building the diagnostic set, and forEachDiagnostic reads
// that same set, so filtering there would hide the findings from the underline
// layer and the hover as well. CodeMirror's marks are suppressed in styles.css
// through `markClass` instead, and `tooltipFilter` (applied at render time, so it
// does not touch the stored set) suppresses the lint hover.
//
// `getConfig` is read on each pass so the active profile and any vault overrides
// are current.
export function plumblineDecorations(
	getConfig: () => ResolvedConfig,
): Extension {
	const source = (view: EditorView): CmDiagnostic[] => {
		const result = lint(view.state.doc.toString(), getConfig());
		const docLength = view.state.doc.length;
		const diagnostics: PlumblineDiagnostic[] = [];
		for (const d of result.diagnostics) {
			if (d.end > d.start && d.end <= docLength) {
				diagnostics.push({
					from: d.start,
					to: d.end,
					severity: cmSeverity(d.severity),
					message: d.message,
					// Hidden in styles.css. The class exists only to give that
					// rule something to target; the visible underline is the
					// coverage-segment layer.
					markClass: 'plumbline-flag',
					plumbline: d,
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
		linter(source, {
			delay: LINT_DELAY,
			needsRefresh,
			tooltipFilter: () => [],
		}),
		lintGutter({ tooltipFilter: (ds) => [gutterTooltip(ds)] }),
		segmentUnderlines(),
		findingsHover(),
	];
}

// Re-run the engine and redraw now, without waiting for the next edit. Called when
// the config changes (profile switch, rule toggle, config reload). The dispatched
// effect makes the linter treat the config as changed via needsRefresh, and
// forceLinting then runs the pass immediately instead of after the debounce.
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
	forceLinting(view);
}
