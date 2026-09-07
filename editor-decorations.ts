import { Extension, Range, StateEffect } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	Tooltip,
	ViewPlugin,
	ViewUpdate,
	hoverTooltip,
} from '@codemirror/view';
import { lint } from './engine/lint';
import { Diagnostic, ResolvedConfig, Severity } from './engine/types';
import { coverageSegments } from './underline-coverage';

// Dispatched to an editor when the plugin config changes (profile switch, rule
// toggle, config reload) so the underlines re-render at once rather than on the
// next keystroke.
const configChanged = StateEffect.define<null>();

// How long the pointer must rest on a finding before its popup appears.
const HOVER_TIME = 200;

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

// The visible underlines: one line per coverage segment, colored by the worst
// severity covering it, and drawn as a double underline where two or more findings
// overlap so a denser spot is visibly different from a single-issue one. Segments
// never overlap, so each is one clean mark.
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

function segmentUnderlines(getConfig: () => ResolvedConfig): Extension {
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

// The hover popup, on the underlined word. It reads the same engine call as the
// underlines, so the two can never disagree, and it is a plain hover tooltip this
// plugin owns rather than CodeMirror's lint hover. That matters: the lint hover
// dismissed itself the instant it appeared (its `hideOn` fires on any change),
// which read as a flash, and it competed with the lint gutter's own tooltip. This
// one does not auto-dismiss on a change, so it stays put while the pointer rests.
function findingsHover(getConfig: () => ResolvedConfig): Extension {
	return hoverTooltip(
		(view, pos): Tooltip | null => {
			const result = lint(view.state.doc.toString(), getConfig());
			const covering = result.diagnostics.filter(
				(d) => d.end > d.start && pos >= d.start && pos <= d.end,
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

// The editor integration: the single/double-underline density marks and one hover
// popup, both driven by the same engine call. No CodeMirror lint hover or gutter.
// `getConfig` is read on each run so the active profile and vault overrides stay
// current.
export function plumblineDecorations(
	getConfig: () => ResolvedConfig,
): Extension {
	return [segmentUnderlines(getConfig), findingsHover(getConfig)];
}

// Re-render the underlines now, without waiting for the next edit. Called when the
// config changes (profile switch, rule toggle, config reload). The hover reads the
// current config on each hover, so it needs no refresh.
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
}
