import {
	EditorState,
	Extension,
	Range,
	RangeSet,
	RangeValue,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	GutterMarker,
	Tooltip,
	ViewPlugin,
	ViewUpdate,
	gutter,
	hoverTooltip,
} from '@codemirror/view';
import { lint } from './engine/lint';
import { Diagnostic, ResolvedConfig, Severity } from './engine/types';
import { coverageSegments, segmentAt } from './underline-coverage';
import { summarizeSeverities } from './gutter-summary';

// This plugin owns every surface it draws, and shares none of them.
//
// It used to run through @codemirror/lint: `linter()` for scheduling, the lint
// state for storage, `lintGutter()` for the marker. All three are shared with any
// other extension in the same editor, and that is not a detail. `lintConfig` is a
// combined facet, so a `tooltipFilter` here suppressed every other plugin's lint
// hover; the lint gutter is one gutter, so filtering it to this plugin's findings
// deleted other plugins' markers. Filtering the other way round let a foreign
// diagnostic colour this plugin's bar. There is no filter setting that is correct,
// because the premise was wrong: a plugin-specific signal does not belong in
// shared infrastructure.
//
// So: a private state field, a private debounce, a private gutter with its own
// class, and a hover keyed on this plugin's own findings. Nothing here can affect
// another extension, and nothing another extension does can affect this.

// Dispatched when the plugin config changes (profile switch, rule toggle, config
// reload) so the pass re-runs at once rather than on the next keystroke.
const configChanged = StateEffect.define<null>();

// Carries a completed engine pass into the state field.
const setFindings = StateEffect.define<readonly Diagnostic[]>();

// Debounce for the engine pass while typing. One pass feeds the underlines, the
// hover and the gutter, so this is the only place the engine runs.
const LINT_DELAY = 400;

// How long the pointer must rest on a finding before its popup appears.
const HOVER_TIME = 200;

// One finding, held in a RangeSet so CodeMirror maps its position through every
// edit. That mapping is the reason findings are stored as ranges rather than kept
// as the offsets the engine returned: between a keystroke and the next debounced
// pass those offsets are stale, and the marks would sit on the wrong words.
class FindingValue extends RangeValue {
	constructor(readonly diagnostic: Diagnostic) {
		super();
	}
}

const findingsField = StateField.define<RangeSet<FindingValue>>({
	create() {
		return RangeSet.empty;
	},
	update(value, tr) {
		// Mapped first, so a pass that arrives in the same transaction as a
		// change replaces the mapped set rather than being mapped itself.
		let next = value.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setFindings)) {
				const docLength = tr.state.doc.length;
				const ranges: Range<FindingValue>[] = [];
				for (const d of effect.value) {
					if (d.end > d.start && d.end <= docLength) {
						ranges.push(new FindingValue(d).range(d.start, d.end));
					}
				}
				next = RangeSet.of(ranges, true);
			}
		}
		return next;
	},
});

// The findings currently held, at their CURRENT positions.
function findingsIn(state: EditorState): Diagnostic[] {
	const out: Diagnostic[] = [];
	const iter = state.field(findingsField).iter();
	while (iter.value) {
		if (iter.to > iter.from) {
			out.push({
				...iter.value.diagnostic,
				start: iter.from,
				end: iter.to,
			});
		}
		iter.next();
	}
	return out;
}

// Runs the engine, debounced, and pushes the result into the field. The only
// caller of lint() in the editor path.
function findingsPass(getConfig: (text: string) => ResolvedConfig): Extension {
	return ViewPlugin.fromClass(
		class {
			private timer: number | null = null;
			private destroyed = false;

			// The first pass is SCHEDULED, never run inline. A ViewPlugin may not
			// dispatch from its constructor: CodeMirror throws, catches, and
			// disables the plugin, which kills the debounce and every later pass
			// with it, silently. Zero delay so the first paint is still immediate.
			constructor(private readonly view: EditorView) {
				this.schedule(0);
			}

			update(update: ViewUpdate): void {
				// A config change runs at once; only typing is debounced. The
				// debounce exists to avoid re-linting on every keystroke, and a
				// profile switch or rule toggle is neither frequent nor a
				// keystroke. Making it wait 400ms leaves the old underlines and
				// bars on screen after the user has changed the rules, and breaks
				// relintEditor's contract, which is that the editor refreshes now.
				if (
					update.transactions.some((tr) =>
						tr.effects.some((e) => e.is(configChanged)),
					)
				) {
					this.schedule(0);
					return;
				}
				if (update.docChanged) {
					this.schedule(LINT_DELAY);
				}
			}

			private schedule(delay: number): void {
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
				}
				this.timer = window.setTimeout(() => {
					this.timer = null;
					this.run();
				}, delay);
			}

			// Guarded on `destroyed` because the timer outlives the plugin when a
			// leaf is closed mid-debounce, and dispatching into a torn-down view
			// throws.
			private run(): void {
				if (this.destroyed) {
					return;
				}
				// The text goes to getConfig as well as to lint. The note's own
				// `plumbline-profile` selects which packs are active, and that
				// has to be decided before the config is resolved.
				const text = this.view.state.doc.toString();
				const result = lint(text, getConfig(text));
				this.view.dispatch({
					effects: setFindings.of(result.diagnostics),
				});
			}

			destroy(): void {
				this.destroyed = true;
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
					this.timer = null;
				}
			}
		},
	);
}

// The visible underlines: one mark per coverage segment, coloured by the worst
// severity covering it, doubled where two or more findings overlap so a denser
// spot is visibly different from a single-issue one. Segments never overlap, so
// each is one clean mark and the line height is not a constraint.
function buildUnderlines(state: EditorState): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	for (const seg of coverageSegments(findingsIn(state))) {
		const multi = seg.count >= 2 ? ' plumbline-mark-multi' : '';
		ranges.push(
			Decoration.mark({
				class: `plumbline-mark plumbline-mark-${seg.severity}${multi}`,
			}).range(seg.start, seg.end),
		);
	}
	return Decoration.set(ranges, true);
}

// A short, human label for the severity, shown as a coloured tag in the popup so a
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

// One finding row for the popup: a coloured severity tag and the rule message.
function renderFinding(diagnostic: Diagnostic): HTMLElement {
	const el = createDiv({ cls: 'plumbline-hover-item' });
	el.createSpan({
		cls: `plumbline-hover-tag plumbline-hover-tag-${diagnostic.severity}`,
		text: severityLabel(diagnostic.severity),
	});
	el.createSpan({ cls: 'plumbline-hover-text', text: diagnostic.message });
	return el;
}

// The hover popup on an underlined phrase. Reads the same field the underlines
// read, so the two cannot disagree.
function findingsHover(): Extension {
	return hoverTooltip(
		(view, pos, side): Tooltip | null => {
			// `end` is EXCLUSIVE, matching Span, report.ts's slice and
			// CodeMirror's own ranges, so the last position covered is
			// `end - 1`. With `pos <= d.end` two adjacent findings both matched
			// at their shared boundary, and the popup showed both messages over a
			// span covering both ranges when only the second is under the pointer.
			// The coverage segment under the pointer bounds the popup, and the
			// findings spanning that whole segment are its contents. CodeMirror keeps
			// a tooltip alive while the pointer stays inside the range returned here
			// and only re-runs this source once it leaves, so the range has to be the
			// exact stretch over which these messages stay true. Segments are split on
			// every finding boundary, so crossing into a different set of findings
			// leaves the segment and rebuilds the popup. See segmentAt.
			// `side` is -1 when the pointer sits BEFORE `pos`, meaning it is over
			// the character at `pos - 1`. Ignoring it made the trailing half of a
			// finding's last character resolve to whatever starts at `pos`, so
			// that half either showed the next finding's messages or nothing at
			// all. Segment lookup is character-based, so the character under the
			// pointer is the one to ask about.
			const at = side < 0 ? pos - 1 : pos;
			const all = findingsIn(view.state);
			const seg = segmentAt(all, at);
			if (seg === null) {
				return null;
			}
			const covering = all.filter(
				(d) => d.start <= seg.start && d.end >= seg.end,
			);
			const start = seg.start;
			// `seg.end` is exclusive, but CodeMirror's hover persistence check is
			// inclusive on both sides (`isOverRange`: `pos >= from && pos <= to`),
			// so passing it verbatim kept the popup alive one position into the
			// NEXT segment and showed its messages over that boundary character.
			// The last position this segment actually covers is `end - 1`.
			const end = Math.max(seg.start, seg.end - 1);
			return {
				pos: start,
				end,
				above: false,
				create() {
					const dom = createDiv({ cls: 'plumbline-hover' });
					let host: HTMLElement | null = null;
					for (const d of covering) {
						dom.appendChild(renderFinding(d));
					}
					return {
						dom,
						// The container is CodeMirror's and is shared with every
						// other hover tooltip in the app, so theming
						// `.cm-tooltip-hover` alone would restyle other plugins'
						// tooltips. Tagging it here lets styles.css theme only
						// the containers holding this plugin's popup. `mount`
						// runs once the tooltip is in the DOM, which is the
						// first point the parent exists.
						// Theming the shared host is a deliberate trade-off, not
						// isolation, and the honest version is this: CodeMirror
						// merges hovers at the same position into ONE host, so if
						// another extension ever shows a hover over the same range
						// its section inherits these colours for as long as this
						// popup is up.
						//
						// The alternative is worse and was measured. With no host
						// theming the container computes to a 245,245,245
						// background under Obsidian's dark theme while the text
						// stays white: CodeMirror's own dark tooltip rule does not
						// win, so the message is unreadable. A guaranteed
						// unreadable popup on every dark theme is not a trade for
						// a hypothetical collision with an extension that would
						// have to hover the same characters.
						//
						// The class is scoped as tightly as it can be: added on
						// mount, removed on destroy, and never left behind. The
						// container is captured here rather than looked up again
						// in destroy(), because CodeMirror detaches `dom` first,
						// so `dom.parentElement` is null by then.
						mount() {
							host = dom.parentElement;
							host?.classList.add('plumbline-tooltip');
						},
						destroy() {
							host?.classList.remove('plumbline-tooltip');
							host = null;
						},
					};
				},
			};
		},
		{
			hoverTime: HOVER_TIME,
			// Closed when the user edits or moves the selection, because the
			// popup's content is a snapshot: CodeMirror maps the tooltip's range
			// through a change but never re-runs the hover source, so a popup
			// left open across an edit can describe a finding the prose no longer
			// has. This is not the flash that made CodeMirror's lint hover
			// unusable; that fired on the diagnostic transaction, which has
			// neither `docChanged` nor `selection`.
			hideOnChange: true,
			// A config change can disable the very rule the open popup is
			// describing, and neither `configChanged` nor the pass that follows it
			// satisfies `hideOnChange`, so the popup would sit there citing a rule
			// the user just turned off.
			//
			// Deliberately NOT also hiding on `setFindings`. A pass is only ever
			// scheduled by an edit or a config change: an edit already closed the
			// popup through `hideOnChange`, and a config change closes it here. The
			// one case left is a popup re-opened inside the 400ms window after
			// typing, which would then be dismissed under the pointer when the pass
			// lands. That is the flash this plugin stopped using CodeMirror's lint
			// hover to avoid, and it is worse than a message being up to 400ms old.
			hideOn: (tr) => tr.effects.some((e) => e.is(configChanged)),
		},
	);
}

// The per-paragraph severity bar.
//
// CodeMirror renders one gutter element per LOGICAL line, stretched to the full
// height of the wrapped block, so a 1197-character paragraph is a single element
// several hundred pixels tall. Measured over CDP. That makes the marker a tall
// block whose height already tracks paragraph length, so it is drawn as a bar
// rather than a dot: colour carries the worst severity, length carries how much
// prose the findings cover.
//
// The gutter cannot address a phrase, only a paragraph. That is CodeMirror's
// ceiling; the underline and the panel carry phrase-level location, and the
// tooltip here answers the question a density signal can answer.
class SeverityBar extends GutterMarker {
	constructor(
		private readonly severity: Severity,
		private readonly title: string,
	) {
		super();
	}

	override eq(other: GutterMarker): boolean {
		return (
			other instanceof SeverityBar &&
			other.severity === this.severity &&
			other.title === this.title
		);
	}

	override toDOM(): Node {
		const el = createDiv({
			cls: `plumbline-gutter-bar plumbline-gutter-bar-${this.severity}`,
		});
		// A native title rather than a tooltip extension. CodeMirror's tooltip
		// layer is shared, and the gutter summary is a one-line string, so there
		// is nothing here worth taking a shared surface for.
		//
		// No aria-label, deliberately. CodeMirror sets aria-hidden="true" on the
		// `.cm-gutters` ancestor (verified in the running app), so nothing in
		// this subtree reaches the accessibility tree and a label here would be
		// decoration that only looks like an accommodation. The bar is a visual
		// density signal; the findings panel is the accessible surface, and it
		// lists every finding with its message.
		el.setAttribute('title', this.title);
		return el;
	}
}

function severityGutter(): Extension {
	return gutter({
		class: 'plumbline-gutter',
		lineMarker: (view, line) => {
			const severities: Severity[] = [];
			view.state
				.field(findingsField)
				.between(line.from, line.to, (_from, _to, value) => {
					severities.push(value.diagnostic.severity);
				});
			if (severities.length === 0) {
				return null;
			}
			const summary = summarizeSeverities(severities);
			return new SeverityBar(summary.severity, summary.message);
		},
		// Without this the gutter only recomputes on a document change, so a
		// debounced pass that adds findings to an unedited line would not draw
		// its bar until the next keystroke.
		lineMarkerChange: (update) =>
			update.startState.field(findingsField) !==
			update.state.field(findingsField),
	});
}

// The editor integration. One debounced engine pass into one private state field,
// read by three surfaces this plugin owns outright.
//
// `getConfig` is read on each pass so the active profile and any vault overrides
// are current.
export function plumblineDecorations(
	getConfig: (text: string) => ResolvedConfig,
): Extension {
	return [
		findingsField,
		findingsPass(getConfig),
		EditorView.decorations.compute([findingsField], buildUnderlines),
		severityGutter(),
		findingsHover(),
	];
}

// Re-run the engine and redraw now, without waiting for the debounce. Called when
// the config changes (profile switch, rule toggle, config reload).
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
}
