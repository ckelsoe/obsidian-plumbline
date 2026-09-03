import { coverageSegments } from '../underline-coverage';
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
