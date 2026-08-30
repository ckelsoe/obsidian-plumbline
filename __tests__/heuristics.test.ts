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

describe('rhetorical-pivot', () => {
	it('flags a rhetorical application question', () => {
		expect(
			run('But what does this mean for us today?').map((d) => d.ruleSlug),
		).toContain('rhetorical-pivot');
	});

	it('does not flag a plain question of fact', () => {
		expect(
			run('He asked for bread and fish.').map((d) => d.ruleSlug),
		).not.toContain('rhetorical-pivot');
	});
});

describe('demonstrative-opener', () => {
	it('flags a bare demonstrative opener', () => {
		expect(
			run('This shows the mercy of God.').map((d) => d.ruleSlug),
		).toContain('demonstrative-opener');
	});

	it('does not flag a demonstrative with a noun attached', () => {
		expect(
			run('This adoption changes everything.').map((d) => d.ruleSlug),
		).not.toContain('demonstrative-opener');
	});
});

describe('transitional-stacking', () => {
	it('flags a paragraph-initial transition', () => {
		const text = 'He wrote the letter.\n\nHowever, the church ignored it.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'transitional-stacking',
		);
	});

	it('does not flag a mid-sentence however', () => {
		expect(
			run('The point stands, however, in a smaller way.').map(
				(d) => d.ruleSlug,
			),
		).not.toContain('transitional-stacking');
	});
});

describe('formatting-tells', () => {
	it('flags consecutive bold-led paragraphs', () => {
		const text =
			'**First point.** It matters.\n\n**Second.** It also does.';
		expect(run(text).map((d) => d.ruleSlug)).toContain('formatting-tells');
	});
});

describe('emphasis-fragment', () => {
	it('flags a whole-sentence fragment', () => {
		expect(
			run('The verse is clear. Full stop.').map((d) => d.ruleSlug),
		).toContain('emphasis-fragment');
	});

	it('does not flag a normal short sentence', () => {
		expect(run('He wept.').map((d) => d.ruleSlug)).not.toContain(
			'emphasis-fragment',
		);
	});
});

describe('personal-claims-vague', () => {
	it('flags a first-person claim with no specific', () => {
		const text =
			'I grew up in places where belief was measured by feeling.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'personal-claims-vague',
		);
	});

	it('does not flag when a proper noun anchors it', () => {
		const text =
			'I grew up in Dallas where belief was measured by feeling.';
		expect(run(text).map((d) => d.ruleSlug)).not.toContain(
			'personal-claims-vague',
		);
	});
});

describe('anchor-test', () => {
	it('flags an abstract sentence with no concrete anchor', () => {
		const text =
			'The path of transformation is devotion, intention, and submission.';
		expect(run(text).map((d) => d.ruleSlug)).toContain('anchor-test');
	});
});

describe('applyHeuristics', () => {
	it('has no diagnostics for plain prose', () => {
		expect(run('He kept the promise he made in the spring.')).toEqual([]);
	});
});
