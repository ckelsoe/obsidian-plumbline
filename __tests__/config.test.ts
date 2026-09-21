import {
	profileRuleInfos,
	profileRules,
	profileSpanKinds,
	resolveConfig,
	prettifySlug,
	groupCheckDescriptors,
	describeCheck,
	isCheckEnabledInGroup,
} from '../engine/config';
import {
	starterGroup,
	DEVOTIONAL_NONFICTION_ID,
	PLAIN_NONFICTION_ID,
	GroupDefinition,
} from '../engine/groups';
import { CustomCheck, CUSTOM_PACK_ID } from '../engine/check-store';

const starter = (id: string): GroupDefinition => {
	const group = starterGroup(id);
	if (!group) {
		throw new Error(`missing starter ${id}`);
	}
	return group;
};

const customCheck: CustomCheck = {
	slug: 'corporate-jargon',
	name: 'Corporate jargon',
	message: 'Say it plainly.',
	category: CUSTOM_PACK_ID,
	severity: 'suggestion',
	phrases: ['circle back'],
};

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

describe('resolveConfig disabledSpanKinds', () => {
	it('drops a comment span kind the vault config disables', () => {
		expect(resolveConfig('scripture-book').protectedSpanKinds).toContain(
			'html-comment',
		);
		const off = resolveConfig('scripture-book', {
			disabledRules: [],
			disabledSpanKinds: ['html-comment'],
			rules: [],
			overrides: {},
		});
		expect(off.protectedSpanKinds).not.toContain('html-comment');
		// The Annoteca kind is independent and stays on.
		expect(off.protectedSpanKinds).toContain('annoteca-comment');
	});
});

describe('resolveConfig disabledSlugs', () => {
	it('is empty with no vault config and carries the disabled list otherwise', () => {
		expect(resolveConfig('scripture-book').disabledSlugs).toEqual([]);
		expect(
			resolveConfig('scripture-book', {
				disabledRules: ['negation-assertion'],
				disabledSpanKinds: [],
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
			disabledSpanKinds: [],
			rules: [],
			overrides: {},
		});
		expect(
			withoutRule.rules.some((r) => r.slug === 'reader-direction'),
		).toBe(false);
	});
});

describe('prettifySlug', () => {
	it('spaces and sentence-cases a slug', () => {
		expect(prettifySlug('reader-direction')).toBe('Reader direction');
		expect(prettifySlug('anaphora')).toBe('Anaphora');
	});
});

describe('groupCheckDescriptors', () => {
	const plain = starter(PLAIN_NONFICTION_ID);
	const devotional = starter(DEVOTIONAL_NONFICTION_ID);

	it('lists base mechanical checks and the heuristics, plus custom checks', () => {
		const descriptors = groupCheckDescriptors(plain, [customCheck]);
		const bySlug = new Map(descriptors.map((d) => [d.slug, d]));
		expect(bySlug.get('reader-direction')?.isHeuristic).toBe(false);
		expect(bySlug.get('negation-assertion')?.isHeuristic).toBe(true);
		expect(bySlug.get('corporate-jargon')?.isCustom).toBe(true);
		// A base-only group does not draw the scripture pack's checks.
		expect(bySlug.has('devotional-register')).toBe(false);
	});

	it('adds the scripture pack checks for a group that extends it', () => {
		const slugs = groupCheckDescriptors(devotional).map((d) => d.slug);
		expect(slugs).toContain('devotional-register');
	});

	it('gives heuristics the heuristic-tier default confidence', () => {
		const anchor = groupCheckDescriptors(plain).find(
			(d) => d.slug === 'anchor-test',
		);
		// A judgment-tier heuristic carries its own confidence on the record.
		expect(anchor?.defaultConfidence).toBe(0.3);
		const negation = groupCheckDescriptors(plain).find(
			(d) => d.slug === 'negation-assertion',
		);
		expect(negation?.defaultConfidence).toBe(0.6);
	});
});

describe('describeCheck', () => {
	it('resolves a built-in and a custom slug, and returns undefined otherwise', () => {
		expect(describeCheck('reader-direction')?.isCustom).toBe(false);
		expect(describeCheck('corporate-jargon', [customCheck])?.name).toBe(
			'Corporate jargon',
		);
		expect(describeCheck('corporate-jargon')).toBeUndefined();
		expect(describeCheck('ghost')).toBeUndefined();
	});
});

describe('isCheckEnabledInGroup', () => {
	const plain = starter(PLAIN_NONFICTION_ID);
	const readerDirection = describeCheck('reader-direction');
	const devotionalRegister = describeCheck('devotional-register');
	const custom = describeCheck('corporate-jargon', [customCheck]);
	if (!readerDirection || !devotionalRegister || !custom) {
		throw new Error('missing descriptor');
	}

	it('has a pack check on unless the membership turns it off', () => {
		expect(isCheckEnabledInGroup(plain, readerDirection)).toBe(true);
		const off: GroupDefinition = {
			...plain,
			checks: { 'reader-direction': { enabled: false } },
		};
		expect(isCheckEnabledInGroup(off, readerDirection)).toBe(false);
	});

	it('has a pack check off when the group does not extend its pack', () => {
		// Scripture is not in the plain group, so its check is not in scope.
		expect(isCheckEnabledInGroup(plain, devotionalRegister)).toBe(false);
	});

	it('has a custom check off unless the membership enables it', () => {
		expect(isCheckEnabledInGroup(plain, custom)).toBe(false);
		const on: GroupDefinition = {
			...plain,
			checks: { 'corporate-jargon': { enabled: true } },
		};
		expect(isCheckEnabledInGroup(on, custom)).toBe(true);
	});
});

describe('resolveConfig with custom checks', () => {
	it('resolves an enabled custom check into the rule set', () => {
		const groups: GroupDefinition[] = [
			{
				id: 'my-group',
				name: 'My group',
				builtIn: false,
				extends: ['base'],
				rollupThreshold: 4,
				checks: { 'corporate-jargon': { enabled: true } },
			},
		];
		const resolved = resolveConfig('my-group', undefined, groups, [
			customCheck,
		]);
		expect(resolved.rules.some((r) => r.slug === 'corporate-jargon')).toBe(
			true,
		);
	});

	it('leaves an unenabled custom check out', () => {
		const resolved = resolveConfig(
			PLAIN_NONFICTION_ID,
			undefined,
			[],
			[customCheck],
		);
		expect(resolved.rules.some((r) => r.slug === 'corporate-jargon')).toBe(
			false,
		);
	});
});
