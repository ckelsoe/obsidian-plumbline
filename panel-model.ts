import { splitParagraphsWithOffsets } from './engine/sentences';
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
	// 1-based, matching what a reader counts down the note.
	paragraph: number;
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
			const here = finding.occurrences.filter(
				(o) => o.start < para.end && o.end > para.start,
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
			paragraph: i + 1,
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
