import {
	profileRuleInfos,
	profileRules,
	profileSpanKinds,
	resolveConfig,
} from '../engine/config';

describe('profileRules', () => {
	it('returns the base rules for an unknown profile', () => {
		const slugs = profileRules('nope').map((r) => r.packId);
		expect(slugs.every((packId) => packId === 'base')).toBe(true);
		expect(profileRules('nope').length).toBeGreaterThan(0);
	});

	it('adds the scripture pack for the scripture profile', () => {
		const base = profileRules('nope');
		const scripture = profileRules('scripture-book');
		expect(scripture.length).toBeGreaterThan(base.length);
		expect(scripture.some((r) => r.packId === 'scripture')).toBe(true);
	});
});

describe('profileSpanKinds', () => {
	it('adds the scripture span only for the scripture profile', () => {
		expect(profileSpanKinds('nope')).not.toContain('scripture');
		expect(profileSpanKinds('scripture-book')).toContain('scripture');
	});
});

describe('profileRuleInfos', () => {
	it('lists mechanical rules and the heuristics together', () => {
		const slugs = profileRuleInfos('scripture-book').map((r) => r.slug);
		// A mechanical rule and a heuristic rule are both toggleable.
		expect(slugs).toContain('reader-direction');
		expect(slugs).toContain('negation-assertion');
	});
});

describe('resolveConfig disabledSlugs', () => {
	it('is empty with no vault config and carries the disabled list otherwise', () => {
		expect(resolveConfig('scripture-book').disabledSlugs).toEqual([]);
		expect(
			resolveConfig('scripture-book', {
				disabledRules: ['negation-assertion'],
				rules: [],
				overrides: {},
			}).disabledSlugs,
		).toEqual(['negation-assertion']);
	});
});

describe('resolveConfig with a vault config', () => {
	it('drops a rule the vault config disables', () => {
		const withRule = resolveConfig('scripture-book');
		expect(withRule.rules.some((r) => r.slug === 'reader-direction')).toBe(
			true,
		);
		const withoutRule = resolveConfig('scripture-book', {
			disabledRules: ['reader-direction'],
			rules: [],
			overrides: {},
		});
		expect(
			withoutRule.rules.some((r) => r.slug === 'reader-direction'),
		).toBe(false);
	});
});
