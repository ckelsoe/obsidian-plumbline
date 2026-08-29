import { applyHeuristics } from '../engine/heuristics';
import { splitSentencesWithOffsets } from '../engine/sentences';

function run(text: string) {
	return applyHeuristics(text, splitSentencesWithOffsets(text));
}

describe('negation-assertion', () => {
	it('flags a negation set up to be corrected', () => {
		const text = 'It is not an emotion. It is a settled trust.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'negation-assertion',
		);
	});

	it('does not flag a lone negation with no following sentence', () => {
		expect(
			run('It is not an emotion.').map((d) => d.ruleSlug),
		).not.toContain('negation-assertion');
	});
});

describe('anaphora', () => {
	it('flags a repeated opening across adjacent sentences', () => {
		const text =
			'In the beginning God created. In the beginning was the Word.';
		const diag = run(text).find((d) => d.ruleSlug === 'anaphora');
		expect(diag).toBeDefined();
		if (diag) {
			expect(text.slice(diag.start, diag.end)).toBe('In the');
		}
	});

	it('does not flag differing openings', () => {
		expect(
			run('The Lord is good. The people rejoiced.').map(
				(d) => d.ruleSlug,
			),
		).not.toContain('anaphora');
	});
});

describe('applyHeuristics', () => {
	it('has no diagnostics for plain prose', () => {
		expect(run('He kept the promise he made in the spring.')).toEqual([]);
	});
});
