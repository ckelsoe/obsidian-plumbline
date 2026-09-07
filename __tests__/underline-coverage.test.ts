import { coverageSegments, coveringIntersection } from '../underline-coverage';
import { Diagnostic, Severity } from '../engine/types';

function diag(
	start: number,
	end: number,
	severity: Severity = 'suggestion',
	slug = 's',
): Diagnostic {
	return {
		ruleSlug: slug,
		severity,
		start,
		end,
		message: slug,
		packId: 'base',
	};
}

describe('coverageSegments', () => {
	it('reports a single finding as one segment with count 1', () => {
		expect(coverageSegments([diag(0, 5)])).toEqual([
			{ start: 0, end: 5, count: 1, severity: 'suggestion' },
		]);
	});

	it('splits a nested overlap into a count-2 head and a count-1 tail', () => {
		// The example: "This is" (0-7) inside "This is not a flaw..." (0-34).
		const segs = coverageSegments([diag(0, 7), diag(0, 34)]);
		expect(segs).toEqual([
			{ start: 0, end: 7, count: 2, severity: 'suggestion' },
			{ start: 7, end: 34, count: 1, severity: 'suggestion' },
		]);
	});

	it('takes the worst severity in a segment', () => {
		const segs = coverageSegments([
			diag(0, 10, 'suggestion'),
			diag(0, 10, 'error'),
			diag(0, 10, 'warning'),
		]);
		expect(segs).toEqual([
			{ start: 0, end: 10, count: 3, severity: 'error' },
		]);
	});

	it('leaves a gap between disjoint findings uncovered', () => {
		const segs = coverageSegments([diag(0, 5), diag(10, 15)]);
		expect(segs).toEqual([
			{ start: 0, end: 5, count: 1, severity: 'suggestion' },
			{ start: 10, end: 15, count: 1, severity: 'suggestion' },
		]);
	});
});

describe('coveringIntersection', () => {
	// The case that motivated it. CodeMirror keeps a hover alive while the
	// pointer is inside the returned range, so a union would keep one popup up
	// across text a different subset of findings covers.
	it('returns the overlap of partially overlapping findings, not the union', () => {
		expect(
			coveringIntersection([
				{ start: 0, end: 10 },
				{ start: 5, end: 15 },
			]),
		).toEqual({ start: 5, end: 10 });
	});

	it('returns the narrowest range when one finding contains another', () => {
		expect(
			coveringIntersection([
				{ start: 0, end: 20 },
				{ start: 8, end: 12 },
			]),
		).toEqual({ start: 8, end: 12 });
	});

	it('returns a single finding unchanged', () => {
		expect(coveringIntersection([{ start: 3, end: 9 }])).toEqual({
			start: 3,
			end: 9,
		});
	});

	// The invariant the hover relies on: callers pass only findings containing
	// the hovered position, so that position is always inside the result.
	it('keeps the hovered position inside the result', () => {
		const pos = 7;
		const covering = [
			{ start: 0, end: 10 },
			{ start: 5, end: 15 },
			{ start: 6, end: 8 },
		].filter((d) => pos >= d.start && pos < d.end);
		const r = coveringIntersection(covering);
		expect(r).not.toBeNull();
		expect(r!.start).toBeLessThanOrEqual(pos);
		expect(r!.end).toBeGreaterThan(pos);
	});

	it('has no intersection for an empty list', () => {
		expect(coveringIntersection([])).toBeNull();
	});
});
