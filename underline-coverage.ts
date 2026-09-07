import { Diagnostic, Severity } from './engine/types';

// A stretch of text covered by a fixed set of findings, between two finding
// boundaries. `count` is how many findings cover it and `severity` is the most
// severe among them, so the underline can show density (one line vs a double line)
// and color it by the worst issue present.
export interface CoverageSegment {
	start: number;
	end: number;
	count: number;
	severity: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = {
	suggestion: 0,
	warning: 1,
	error: 2,
};

// Break the flagged text into maximal segments at every finding boundary, and for
// each segment report how many findings cover it and the worst severity among
// them. Segments never overlap, so each renders as one underline: no nesting, and
// the count and color are known per stretch of text. Pure, so it is unit-tested
// apart from the CodeMirror rendering.
export function coverageSegments(
	diagnostics: readonly Diagnostic[],
): CoverageSegment[] {
	const points = [
		...new Set(diagnostics.flatMap((d) => [d.start, d.end])),
	].sort((a, b) => a - b);
	const segments: CoverageSegment[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const start = points[i] ?? 0;
		const end = points[i + 1] ?? 0;
		let count = 0;
		let severity: Severity = 'suggestion';
		for (const d of diagnostics) {
			if (d.start <= start && d.end >= end) {
				count++;
				if (SEVERITY_RANK[d.severity] > SEVERITY_RANK[severity]) {
					severity = d.severity;
				}
			}
		}
		if (count > 0) {
			segments.push({ start, end, count, severity });
		}
	}
	return segments;
}

// The coverage segment containing `pos`, or null if no finding covers it.
//
// Used to bound the hover popup. CodeMirror keeps a tooltip alive while the
// pointer stays inside the range the hover source returned, and only re-runs the
// source once it leaves, so that range has to be the exact stretch over which the
// popup's contents stay true.
//
// The segment is that stretch, and nothing narrower is needed or wider is safe.
// Two weaker answers were tried and are wrong:
//
//   - The UNION of the findings covering `pos`. Findings [0,10) and [5,15)
//     hovered at 7 give [0,15), so moving to 12 keeps showing both messages when
//     only the second covers it.
//   - Their INTERSECTION. Better, but it only knows about findings that cover
//     `pos`, so it can still span another finding's boundary: hovering 6 with
//     [0,10), [5,15) and [8,9) gives [5,10), and moving to 8 keeps showing two
//     messages when three findings apply.
//
// Segments are split on EVERY finding boundary, so the segment containing `pos`
// cannot contain one. It is also the unit the underline draws, which is why the
// popup and the mark under it agree about where one answer stops.
export function segmentAt(
	diagnostics: readonly Diagnostic[],
	pos: number,
): CoverageSegment | null {
	for (const seg of coverageSegments(diagnostics)) {
		if (pos >= seg.start && pos < seg.end) {
			return seg;
		}
	}
	return null;
}
