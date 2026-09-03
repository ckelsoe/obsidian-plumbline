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
export function coverageSegments(diagnostics: Diagnostic[]): CoverageSegment[] {
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
