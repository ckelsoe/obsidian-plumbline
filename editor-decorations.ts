import {
	EditorState,
	Extension,
	Range,
	RangeSet,
	RangeValue,
	StateEffect,
	StateField,
	Text,
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
import { rulerMarkTitle, rulerMarks } from './ruler-marks';
import {
	visibleUnderlines,
	type CommentAnchor,
	type InlineUnderlines,
} from './yield-to-comments';
import {
	countLabel,
	paragraphLineRange,
	summarizeSeverities,
} from './gutter-summary';

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
// What the underline layer needs from the plugin: the writer's setting, and
// Annoteca's open anchors for the note being edited. Both are read per build
// rather than captured, because either can change without a document change.
export interface YieldSource {
	inlineUnderlines(): InlineUnderlines;
	// Annoteca's anchors for this text, or an empty list when it is absent. Not
	// null: "no anchors" and "no Annoteca" are the same answer here, and contract
	// 5.1 says `auto` behaves as `always` when there is nothing to yield to.
	commentAnchors(text: string): readonly CommentAnchor[];
}

function buildUnderlines(
	state: EditorState,
	yieldTo: YieldSource,
): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	// The yield happens HERE, on the underline layer alone. The gutter, the
	// ruler and the panel still carry every finding, because contract 5.1 gives
	// up the inline mark and nothing else: a suppressed finding is still a
	// finding, and hiding it everywhere would be losing it.
	const shown = visibleUnderlines(
		findingsIn(state),
		yieldTo.commentAnchors(state.doc.toString()),
		yieldTo.inlineUnderlines(),
	);
	for (const seg of coverageSegments(shown)) {
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

// One finding row for the popup: a coloured severity tag, the rule that fired,
// and its message.
//
// The rule NAME is not decoration. It is the only way to find out what to put in
// `plumbline-disabled-rules` when a rule is wrong for your voice, and until it
// was shown here that per-note setting could only be used by reading the
// plugin's source. Vale names the rule on every finding for the same reason;
// architecture.md section 6 says to borrow exactly that.
function renderFinding(
	view: EditorView,
	diagnostic: Diagnostic,
	actions: DecorationActions,
): HTMLElement {
	const el = createDiv({ cls: 'plumbline-hover-item' });
	const head = el.createDiv({ cls: 'plumbline-hover-head' });
	head.createSpan({
		cls: `plumbline-hover-tag plumbline-hover-tag-${diagnostic.severity}`,
		text: severityLabel(diagnostic.severity),
	});
	head.createSpan({
		cls: 'plumbline-hover-rule',
		text: diagnostic.ruleSlug,
	});
	el.createSpan({ cls: 'plumbline-hover-text', text: diagnostic.message });

	const row = el.createDiv({ cls: 'plumbline-hover-actions' });
	const { fix } = diagnostic;
	if (fix !== undefined) {
		const phrase = view.state.doc.sliceString(
			diagnostic.start,
			diagnostic.end,
		);
		const allowed = actions.canReplace(
			view,
			diagnostic.start,
			diagnostic.end,
		);
		const apply = row.createEl('button', {
			cls: 'plumbline-hover-action',
			text: `Use "${fix}"`,
			attr: {
				type: 'button',
				// The visible text is two words out of context. Read aloud it has
				// to say what is being replaced and with what.
				'aria-label': allowed
					? `Replace "${phrase}" with "${fix}"`
					: `Cannot replace "${phrase}": Annoteca has a comment on it`,
				...(allowed
					? {}
					: {
							disabled: 'true',
							title: 'Annoteca has a comment anchored here, so it owns this text.',
						}),
			},
		});
		apply.addEventListener('click', () => {
			if (!allowed) {
				return;
			}
			// A plain document change, so it lands in the editor's own undo
			// history and one ctrl+Z puts the writer's word back. The tooltip
			// closes on the change (hideOnChange), which is what should happen:
			// the finding it described is gone.
			view.dispatch({
				changes: {
					from: diagnostic.start,
					to: diagnostic.end,
					insert: fix,
				},
			});
		});
	}
	if (actions.canAnnotate()) {
		const annotate = row.createEl('button', {
			cls: 'plumbline-hover-action',
			text: 'Annotate',
			attr: {
				type: 'button',
				'aria-label': `Turn this ${diagnostic.ruleSlug} finding into an Annoteca comment`,
				title: 'Create a comment here, so this can be discussed and answered.',
			},
		});
		annotate.addEventListener('click', () => {
			actions.annotate(view, diagnostic);
		});
	}
	const off = row.createEl('button', {
		cls: 'plumbline-hover-action',
		text: 'Turn off here',
		attr: {
			type: 'button',
			'aria-label': `Turn off ${diagnostic.ruleSlug} for this note`,
		},
	});
	off.addEventListener('click', () => {
		actions.disableRule(diagnostic.ruleSlug, view);
	});
	return el;
}

// The hover popup on an underlined phrase. Reads the same field the underlines
// read, so the two cannot disagree.
function findingsHover(actions: DecorationActions): Extension {
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
						dom.appendChild(renderFinding(view, d, actions));
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
		private readonly weight: number,
		private readonly count: string,
	) {
		super();
	}

	override eq(other: GutterMarker): boolean {
		return (
			other instanceof SeverityBar &&
			other.severity === this.severity &&
			other.title === this.title &&
			other.weight === this.weight &&
			other.count === this.count
		);
	}

	override toDOM(): Node {
		// A wrapper, because the bar is a full-height rule and the numeral has to
		// sit beside it rather than inside and be clipped.
		const el = createDiv({ cls: 'plumbline-gutter-marker' });
		el.createDiv({
			cls: `plumbline-gutter-bar plumbline-gutter-bar-${this.severity} plumbline-gutter-bar-w${this.weight}`,
		});
		if (this.count !== '') {
			// Only past one finding. A numeral on every flagged paragraph is
			// noise, and the bar already says "at least one".
			el.createSpan({
				cls: 'plumbline-gutter-count',
				text: this.count,
			});
		}
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

// The document offsets of the paragraph containing this line. The line-number
// arithmetic lives in gutter-summary.ts so it can be tested without CodeMirror.
function paragraphSpan(
	doc: Text,
	lineNumber: number,
): { from: number; to: number; first: number } {
	const { first, last } = paragraphLineRange(
		doc.lines,
		(n) => doc.line(n).text.trim() === '',
		lineNumber,
	);
	return { from: doc.line(first).from, to: doc.line(last).to, first };
}

function severityGutter(): Extension {
	return gutter({
		class: 'plumbline-gutter',
		lineMarker: (view, block) => {
			// `block` is a BlockInfo, which carries geometry but no text. The doc
			// line is what says whether this is blank and which paragraph it is
			// part of.
			const line = view.state.doc.lineAt(block.from);
			if (line.text.trim() === '') {
				return null;
			}
			const para = paragraphSpan(view.state.doc, line.number);
			const severities: Severity[] = [];
			view.state
				.field(findingsField)
				.between(para.from, para.to, (_from, _to, value) => {
					severities.push(value.diagnostic.severity);
				});
			if (severities.length === 0) {
				return null;
			}
			const summary = summarizeSeverities(severities);
			// The bar is drawn on every line of the paragraph, so it still spans
			// the whole block, but the numeral is printed once. Repeating it down
			// a hard-wrapped paragraph would read as several separate counts.
			return new SeverityBar(
				summary.severity,
				summary.message,
				summary.weight,
				line.number === para.first ? countLabel(summary.count) : '',
			);
		},
		// Without this the gutter only recomputes on a document change, so a
		// debounced pass that adds findings to an unedited line would not draw
		// its bar until the next keystroke.
		lineMarkerChange: (update) =>
			update.startState.field(findingsField) !==
			update.state.field(findingsField),
	});
}

// The strip beside the scrollbar showing where the findings are in the whole
// document, so a long chapter can be read at a glance instead of scrolled.
//
// CodeMirror has no overview ruler, so this is a plain absolutely-positioned
// overlay on `.cm-editor`, which CodeMirror already sets `position: relative`
// on. It sits over the scroller rather than inside it, or it would scroll away
// with the content it is a map of.
const overviewRuler = ViewPlugin.fromClass(
	class {
		private readonly dom: HTMLElement;

		constructor(private readonly view: EditorView) {
			this.dom = createDiv({ cls: 'plumbline-ruler' });
			view.dom.appendChild(this.dom);
			this.draw();
		}

		update(update: ViewUpdate): void {
			// Redrawn when the findings change, and when the document does
			// because every mark's position is a fraction of the length.
			if (
				update.docChanged ||
				update.startState.field(findingsField) !==
					update.state.field(findingsField)
			) {
				this.draw();
			}
		}

		destroy(): void {
			this.dom.remove();
		}

		private draw(): void {
			this.dom.empty();
			const marks = rulerMarks(
				findingsIn(this.view.state),
				this.view.state.doc.length,
			);
			for (const mark of marks) {
				// A real button, not a clickable div. It navigates, so it has to
				// be reachable and activatable from the keyboard, and a `title`
				// alone is neither a focus stop nor an accessible name.
				const el = this.dom.createEl('button', {
					cls: `plumbline-ruler-mark plumbline-ruler-mark-${mark.severity}`,
					attr: {
						type: 'button',
						title: rulerMarkTitle(mark),
						'aria-label': rulerMarkTitle(mark),
					},
				});
				// A custom property, not an inline `top`. The position is
				// computed so it cannot live in styles.css, but the DECLARATION
				// can: the stylesheet still owns how a mark is positioned and
				// this passes it the one number it cannot know. Percent, so the
				// mark keeps its place when the editor is resized without a
				// redraw.
				el.style.setProperty(
					'--plumbline-ruler-top',
					`${mark.position * 100}%`,
				);
				el.addEventListener('click', () => {
					this.view.dispatch({
						selection: { anchor: mark.offset },
						effects: EditorView.scrollIntoView(mark.offset, {
							y: 'center',
						}),
					});
					this.view.focus();
				});
			}
		}
	},
);

// What the hover's buttons need from the plugin. Passed in rather than reached
// for, so this module still knows nothing about Obsidian beyond the DOM helpers.
export interface DecorationActions {
	// Turn a rule off for the note THIS editor is showing. The plugin owns it
	// because it writes the note's frontmatter, which is a vault operation.
	//
	// The view is passed rather than resolved later. Reading "the active note"
	// at click time writes to whichever leaf is focused by then, and a hover
	// stays up across a leaf change, so a click could put the rule in a
	// different file from the one whose finding was clicked.
	disableRule(slug: string, view: EditorView): void;
	// Whether Plumbline may replace this range.
	//
	// Interop-contract 4.1 makes Annoteca the only writer of note prose, so a
	// replacement inside one of its anchors would break the byte-for-byte
	// original its reject-as-revert depends on. False means the fix is offered
	// but refused, with the reason on the button.
	canReplace(view: EditorView, from: number, to: number): boolean;
	// Whether Annoteca is present and new enough to accept a promoted comment.
	// Checked at render time so the button is simply absent when it cannot work,
	// rather than offered and then failing (contract: degrade to unpaired
	// behaviour on an absent or unknown apiVersion).
	canAnnotate(): boolean;
	// Turn this finding into an Annoteca comment, so it can be discussed and
	// answered rather than only seen. The one-way bridge in contract 2.
	annotate(view: EditorView, diagnostic: Diagnostic): void;
}

// The editor integration. One debounced engine pass into one private state field,
// read by three surfaces this plugin owns outright.
//
// `getConfig` is read on each pass so the active profile and any vault overrides
// are current.
export function plumblineDecorations(
	getConfig: (text: string) => ResolvedConfig,
	actions: DecorationActions,
	yieldTo: YieldSource,
): Extension {
	return [
		findingsField,
		findingsPass(getConfig),
		EditorView.decorations.compute([findingsField], (state) =>
			buildUnderlines(state, yieldTo),
		),
		severityGutter(),
		overviewRuler,
		findingsHover(actions),
	];
}

// Re-run the engine and redraw now, without waiting for the debounce. Called when
// the config changes (profile switch, rule toggle, config reload).
export function relintEditor(view: EditorView): void {
	view.dispatch({ effects: configChanged.of(null) });
}
