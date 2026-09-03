import { assignLayers } from '../underline-layers';
import { Diagnostic } from '../engine/types';

function diag(start: number, end: number, slug = 's'): Diagnostic {
	return {
		ruleSlug: slug,
		severity: 'suggestion',
		start,
		end,
		message: slug,
		packId: 'base',
	};
}

describe('assignLayers', () => {
	it('keeps non-overlapping findings on the bottom layer', () => {
		const layers = assignLayers([diag(0, 5, 'a'), diag(6, 10, 'b')]);
		expect(layers.map((l) => l.layer)).toEqual([0, 0]);
	});

	it('stacks a nested finding above the wider one', () => {
		// The example: "This is not a flaw in the process." (0-34) plus the
		// demonstrative opener "This is" (0-7).
		const layers = assignLayers([diag(0, 7, 'demo'), diag(0, 34, 'neg')]);
		const byslug = Object.fromEntries(
			layers.map((l) => [l.diagnostic.ruleSlug, l.layer]),
		);
		// Wider range on the bottom line, the short opener stacked above it.
		expect(byslug.neg).toBe(0);
		expect(byslug.demo).toBe(1);
	});

	it('gives three mutually overlapping findings three layers', () => {
		const layers = assignLayers([
			diag(0, 10, 'a'),
			diag(2, 12, 'b'),
			diag(4, 14, 'c'),
		]);
		expect([...layers.map((l) => l.layer)].sort()).toEqual([0, 1, 2]);
	});

	it('reuses a layer once the earlier finding on it has ended', () => {
		// [0,5] and [10,15] do not overlap, so both fit on layer 0; [2,12]
		// overlaps both, so it takes layer 1.
		const layers = assignLayers([
			diag(0, 5, 'a'),
			diag(10, 15, 'b'),
			diag(2, 12, 'c'),
		]);
		const byslug = Object.fromEntries(
			layers.map((l) => [l.diagnostic.ruleSlug, l.layer]),
		);
		expect(byslug.a).toBe(0);
		expect(byslug.b).toBe(0);
		expect(byslug.c).toBe(1);
	});
});
