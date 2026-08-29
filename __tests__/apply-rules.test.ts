import { applyRules } from '../engine/apply-rules';
import { BASE_RULES } from '../engine/packs';

describe('applyRules', () => {
	it('flags a reader-direction phrase with its slug, range, and metadata', () => {
		const text = 'The verse is clear. Read that again.';
		const diags = applyRules(text, BASE_RULES);
		const flag = diags.find((d) => d.ruleSlug === 'reader-direction');
		expect(flag).toBeDefined();
		if (flag) {
			expect(text.slice(flag.start, flag.end).toLowerCase()).toBe(
				'read that again',
			);
			expect(flag.severity).toBe('warning');
			expect(flag.packId).toBe('base');
		}
	});

	it('flags flagged-register vocabulary', () => {
		const slugs = applyRules(
			'We delve into the tapestry of grace.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('flagged-register');
	});

	it('respects word boundaries', () => {
		// "meticulously" contains "meticulous" but is not the flagged word.
		const diags = applyRules('He worked meticulously.', BASE_RULES);
		expect(diags.some((d) => d.ruleSlug === 'flagged-register')).toBe(
			false,
		);
	});

	it('is case-insensitive', () => {
		const diags = applyRules('DELVE into it.', BASE_RULES);
		expect(diags.some((d) => d.ruleSlug === 'flagged-register')).toBe(true);
	});

	it('returns diagnostics sorted by position', () => {
		const text = 'Delve first. Then read that again.';
		const positions = applyRules(text, BASE_RULES).map((d) => d.start);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it('has no diagnostics for clean prose', () => {
		expect(applyRules('He kept the promise he made.', BASE_RULES)).toEqual(
			[],
		);
	});

	it('flags a summative closer', () => {
		const slugs = applyRules(
			'In essence, the point is grace.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('summative-closer');
	});

	it('flags a cinematic opener', () => {
		const slugs = applyRules(
			'In a world where doubt is easy, he believed.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('cinematic-opener');
	});

	it('flags the extended vocabulary', () => {
		const slugs = applyRules(
			'We leverage a seamless plan.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs.filter((s) => s === 'flagged-register').length).toBe(2);
	});
});
