import { coverageSegments, segmentAt } from '../underline-coverage';
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

describe('segmentAt', () => {
	const d = (start: number, end: number): Diagnostic => ({
		ruleSlug: 'r',
		packId: 'p',
		severity: 'warning',
		message: 'm',
		start,
		end,
	});

	// The union of the findings covering pos would be [0,15), so moving to 12
	// would keep a popup up that only the second finding explains.
	it('stops at the boundary of an overlapping finding', () => {
		expect(segmentAt([d(0, 10), d(5, 15)], 7)).toMatchObject({
			start: 5,
			end: 10,
		});
	});

	// The intersection of the findings covering pos would be [5,10), which spans
	// the start of [8,9) and would keep showing two messages at position 8.
	it('stops at the boundary of a finding that does not cover pos', () => {
		expect(segmentAt([d(0, 10), d(5, 15), d(8, 9)], 6)).toMatchObject({
			start: 5,
			end: 8,
		});
	});

	it('returns the segment a single finding covers', () => {
		expect(segmentAt([d(3, 9)], 5)).toMatchObject({ start: 3, end: 9 });
	});

	it('treats the end offset as exclusive', () => {
		expect(segmentAt([d(3, 9)], 8)).not.toBeNull();
		expect(segmentAt([d(3, 9)], 9)).toBeNull();
	});

	it('returns null where nothing covers the position', () => {
		expect(segmentAt([d(3, 9)], 1)).toBeNull();
		expect(segmentAt([], 0)).toBeNull();
	});

	// The invariant the hover depends on: the popup's range always contains the
	// position it was built for.
	it('always contains the position it was asked about', () => {
		for (const pos of [5, 6, 7, 8, 9, 12]) {
			const seg = segmentAt([d(0, 10), d(5, 15), d(8, 9)], pos);
			if (seg !== null) {
				expect(seg.start).toBeLessThanOrEqual(pos);
				expect(seg.end).toBeGreaterThan(pos);
			}
		}
	});
});
