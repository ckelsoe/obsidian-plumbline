import { lineOf, splitParagraphsWithOffsets } from './engine/sentences';
import { priorityOf } from './engine/rollup';
import { Finding, Occurrence, Severity } from './engine/types';

// What the findings panel draws: volume levels two and three of
// interop-contract section 3, as data rather than as DOM.
//
// Kept out of findings-view.ts so it can be tested. That module imports Obsidian,
// and this project's jest runs on the 'node' environment. Same split as
// gutter-summary.ts and underline-coverage.ts.

// Rows shown before the panel offers "show all". A pathological note should not
// freeze the view, and nobody reads past the first screen anyway.
export const DEFAULT_ROW_CAP = 25;

// Severities shown as their own rows. Anything below collapses into one counted
// row per paragraph: never silently hidden, always counted, one click to expand.
const ABOVE_FLOOR: readonly Severity[] = ['error', 'warning'];

// One rule's findings within ONE paragraph. `occurrences` are only that
// paragraph's, so a rule firing across a chapter reports where it fired here
// rather than a count the reader cannot locate.
export interface PanelRow {
	ruleSlug: string;
	severity: Severity;
	message: string;
	occurrences: Occurrence[];
	priority: number;
}

export interface PanelSection {
	// The paragraph's position in splitParagraphsWithOffsets order. INTERNAL: a
	// stable-enough key for collapse state, never a label. It counts every block
	// including headings, so showing it told the reader to go and count
	// something they would then get wrong.
	paragraphIndex: number;
	// 1-based line the paragraph starts on. This is the locator a writer can
	// actually use, because it matches the editor's own line numbers.
	line: number;
	// The paragraph's opening words, for recognising the passage at a glance.
	excerpt: string;
	start: number;
	end: number;
	rows: PanelRow[];
	// Occurrence counts for the WHOLE paragraph, before the cap and before the
	// floor. The summary is a claim about the prose, not about what the panel
	// happens to be drawing, so counting the visible rows made a paragraph with
	// 30 warnings read "25 warnings" while a "Show 5 more" sat under it.
	counts: Record<Severity, number>;
	// Collapsed suggestions for this paragraph. `rows` is what expanding shows.
	//
	// `count` is OCCURRENCES, not rules, so the button and the section header
	// count the same thing. Counting rules made a header reading "5 suggestions"
	// sit above a button reading "1 suggestion", which is two different answers
	// to the same question in the same block.
	collapsed: { count: number; rows: PanelRow[] };
}

export interface PanelModel {
	sections: PanelSection[];
	// Rows the cap is hiding, across every section. Zero when nothing is hidden.
	hidden: number;
}

// Characters of opening text a section header shows. Long enough to recognise
// the passage, short enough not to wrap in a sidebar leaf.
const EXCERPT_LENGTH = 48;

// The paragraph's opening words.
//
// Leading Markdown structure is stripped, so a quoted or listed paragraph shows
// its words rather than its punctuation. Cut at a word boundary when there is
// one, because a label ending mid-word reads as corruption rather than as a
// truncation.
export function excerptOf(paragraph: string): string {
	const text = paragraph
		.replace(/^[>\s]+/, '')
		.replace(/^(?:[-*+]|\d+\.)[ \t]+/, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= EXCERPT_LENGTH) {
		return text;
	}
	const cut = text.slice(0, EXCERPT_LENGTH);
	const lastSpace = cut.lastIndexOf(' ');
	// Only honour the word boundary if it leaves most of the excerpt. A very long
	// first word would otherwise collapse the label to almost nothing.
	const body = lastSpace > EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
	return `${body.trimEnd()}...`;
}

function rowFor(finding: Finding, occurrences: Occurrence[]): PanelRow {
	return {
		ruleSlug: finding.ruleSlug,
		severity: finding.severity,
		message: finding.message,
		occurrences,
		// Recomputed from THIS paragraph's count, not carried from the whole-note
		// finding. A rule that fired once here and eleven times elsewhere should
		// not lead this paragraph on the strength of the eleven.
		priority: priorityOf(
			finding.severity,
			occurrences.length,
			finding.confidence,
		),
	};
}

// Group findings by the paragraph their occurrences fall in, rank within each,
// collapse what is below the floor, and cap the total.
//
// A finding whose occurrences span several paragraphs appears in each of them,
// carrying only that paragraph's occurrences. That is the point of grouping by
// paragraph: the reader is looking at one stretch of prose and asking what is
// wrong with it.
export function buildPanelModel(
	text: string,
	findings: readonly Finding[],
	cap: number = DEFAULT_ROW_CAP,
): PanelModel {
	const paragraphs = splitParagraphsWithOffsets(text);
	const sections: PanelSection[] = [];
	let shown = 0;
	let hidden = 0;

	for (const [i, para] of paragraphs.entries()) {
		const rows: PanelRow[] = [];
		const collapsed: PanelRow[] = [];
		for (const finding of findings) {
			// Assigned by START, so an occurrence belongs to exactly one
			// paragraph. Overlap put a range crossing a blank line into BOTH,
			// duplicating its row and double-counting it in two summaries. That
			// is reachable rather than theoretical: a paragraph without terminal
			// punctuation lets a sentence continue past the blank line, and
			// several heuristics flag the whole sentence.
			const here = finding.occurrences.filter(
				(o) => o.start >= para.start && o.start < para.end,
			);
			if (here.length === 0) continue;
			const row = rowFor(finding, here);
			if (ABOVE_FLOOR.includes(finding.severity)) {
				rows.push(row);
			} else {
				collapsed.push(row);
			}
		}
		if (rows.length === 0 && collapsed.length === 0) continue;

		// Counted from everything found in this paragraph, before any capping.
		const counts: Record<Severity, number> = {
			error: 0,
			warning: 0,
			suggestion: 0,
		};
		for (const r of [...rows, ...collapsed]) {
			counts[r.severity] += r.occurrences.length;
		}

		rows.sort(
			(a, b) =>
				b.priority - a.priority || a.ruleSlug.localeCompare(b.ruleSlug),
		);
		collapsed.sort(
			(a, b) =>
				b.priority - a.priority || a.ruleSlug.localeCompare(b.ruleSlug),
		);

		// The cap counts the rows actually drawn. A collapsed group is one row
		// however many findings it stands for, which is what makes it worth
		// collapsing.
		const budget = Math.max(0, cap - shown);
		const kept = rows.slice(0, budget);
		hidden += rows.length - kept.length;
		shown += kept.length;
		// A collapsed group that does not fit is DROPPED from the section, not
		// merely counted as hidden. Counting it and returning it anyway let the
		// renderer draw the button and its rows regardless, so a note whose
		// findings are suggestions across many paragraphs rendered well past the
		// cap while also offering a "Show N more" that was already showing them.
		const fitsCollapsed = collapsed.length > 0 && shown < cap;
		if (collapsed.length > 0) {
			if (fitsCollapsed) {
				shown += 1;
			} else {
				hidden += 1;
			}
		}
		if (kept.length === 0 && !fitsCollapsed) continue;

		sections.push({
			paragraphIndex: i + 1,
			line: lineOf(text, para.start),
			excerpt: excerptOf(text.slice(para.start, para.end)),
			start: para.start,
			end: para.end,
			rows: kept,
			counts,
			collapsed: fitsCollapsed
				? {
						count: collapsed.reduce(
							(n, r) => n + r.occurrences.length,
							0,
						),
						rows: collapsed,
					}
				: { count: 0, rows: [] },
		});
	}

	return { sections, hidden };
}

// The one-line summary a section header shows, so a reader can decide whether to
// look before reading any row. Same shape the gutter bar uses, deliberately: the
// two describe the same paragraph and disagreeing would be worse than repeating.
export function sectionSummary(section: PanelSection): string {
	const parts: string[] = [];
	for (const sev of ['error', 'warning', 'suggestion'] as const) {
		const n = section.counts[sev];
		if (n > 0) parts.push(`${n} ${sev}${n === 1 ? '' : 's'}`);
	}
	return parts.join(', ');
}
