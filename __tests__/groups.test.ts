import {
	resolveGroup,
	starterGroup,
	fallbackGroup,
	migrateGroupId,
	groupPackRules,
	STARTER_GROUPS,
	DEVOTIONAL_NONFICTION_ID,
	PLAIN_NONFICTION_ID,
	GroupDefinition,
} from '../engine/groups';
import { resolveConfig } from '../engine/config';
import { BASE_RULES } from '../engine/packs';
import { SCRIPTURE_RULES } from '../engine/scripture';

function group(id: string): GroupDefinition {
	const g = starterGroup(id);
	if (!g) {
		throw new Error(`missing starter group ${id}`);
	}
	return g;
}

const devotional = group(DEVOTIONAL_NONFICTION_ID);
const plain = group(PLAIN_NONFICTION_ID);

describe('starter groups', () => {
	it('ships the two built-in starters, read-only', () => {
		expect(STARTER_GROUPS.map((g) => g.id)).toEqual([
			DEVOTIONAL_NONFICTION_ID,
			PLAIN_NONFICTION_ID,
		]);
		expect(STARTER_GROUPS.every((g) => g.builtIn)).toBe(true);
	});
});

describe('resolveGroup: devotional nonfiction', () => {
	const resolved = resolveGroup(devotional);

	it('turns on every base and scripture check at its default', () => {
		const expected = [...BASE_RULES, ...SCRIPTURE_RULES].map((r) => r.slug);
		expect(resolved.rules.map((r) => r.slug)).toEqual(expected);
	});

	it('masks quoted verse and starts with nothing disabled', () => {
		expect(resolved.protectedSpanKinds).toContain('scripture');
		expect(resolved.disabledSlugs).toEqual([]);
		expect(resolved.confidenceBySlug).toEqual({});
		expect(resolved.rollupThreshold).toBe(4);
		expect(resolved.profileId).toBe(DEVOTIONAL_NONFICTION_ID);
	});
});

describe('resolveGroup: plain nonfiction', () => {
	const resolved = resolveGroup(plain);

	it('carries only base checks, no scripture pack', () => {
		expect(resolved.rules.every((r) => r.packId === 'base')).toBe(true);
		expect(resolved.rules.some((r) => r.packId === 'scripture')).toBe(
			false,
		);
	});

	it('does not mask quoted verse', () => {
		expect(resolved.protectedSpanKinds).not.toContain('scripture');
	});
});

describe('resolveGroup: per-membership tuning', () => {
	it('overrides a mechanical check severity without mutating the pack record', () => {
		const original = BASE_RULES.find((r) => r.slug === 'reader-direction');
		const before = original?.severity;
		const tuned: GroupDefinition = {
			...plain,
			checks: { 'reader-direction': { severity: 'error' } },
		};
		const rule = resolveGroup(tuned).rules.find(
			(r) => r.slug === 'reader-direction',
		);
		expect(rule?.severity).toBe('error');
		// The shared pack record is untouched.
		expect(original?.severity).toBe(before);
	});

	it('drops a disabled mechanical check into disabledSlugs', () => {
		const tuned: GroupDefinition = {
			...plain,
			checks: { 'reader-direction': { enabled: false } },
		};
		const resolved = resolveGroup(tuned);
		expect(resolved.rules.some((r) => r.slug === 'reader-direction')).toBe(
			false,
		);
		expect(resolved.disabledSlugs).toContain('reader-direction');
	});

	it('disables a heuristic through disabledSlugs, leaving the rule list alone', () => {
		const tuned: GroupDefinition = {
			...plain,
			checks: { 'emphasis-fragment': { enabled: false } },
		};
		const resolved = resolveGroup(tuned);
		expect(resolved.disabledSlugs).toContain('emphasis-fragment');
		// Heuristics are not in `rules`, so the mechanical list is unchanged.
		expect(resolved.rules.map((r) => r.slug)).toEqual(
			groupPackRules(plain).map((r) => r.slug),
		);
	});

	it('carries a confidence override and clamps it', () => {
		const tuned: GroupDefinition = {
			...plain,
			checks: {
				'reader-direction': { confidence: 0.15 },
				'summative-closer': { confidence: 2 },
			},
		};
		const resolved = resolveGroup(tuned);
		expect(resolved.confidenceBySlug['reader-direction']).toBe(0.15);
		expect(resolved.confidenceBySlug['summative-closer']).toBe(1);
	});

	it('clamps a bad rollup threshold to the default', () => {
		const tuned: GroupDefinition = { ...plain, rollupThreshold: 0 };
		expect(resolveGroup(tuned).rollupThreshold).toBe(4);
	});
});

describe('legacy id migration', () => {
	it('maps the old scripture-book id to the devotional group', () => {
		expect(starterGroup('scripture-book')?.id).toBe(
			DEVOTIONAL_NONFICTION_ID,
		);
		expect(migrateGroupId('scripture-book')).toBe(DEVOTIONAL_NONFICTION_ID);
	});

	it('passes every other id through untouched', () => {
		expect(migrateGroupId(PLAIN_NONFICTION_ID)).toBe(PLAIN_NONFICTION_ID);
		expect(migrateGroupId('fiction')).toBe('fiction');
	});

	it('resolves the legacy id to the devotional group through resolveConfig', () => {
		expect(resolveConfig('scripture-book').profileId).toBe(
			DEVOTIONAL_NONFICTION_ID,
		);
	});
});

describe('unknown group id', () => {
	it('falls back to the base-only group, never another genre pack', () => {
		expect(fallbackGroup().id).toBe(PLAIN_NONFICTION_ID);
		const resolved = resolveConfig('fiction');
		expect(resolved.rules.some((r) => r.packId === 'scripture')).toBe(
			false,
		);
		expect(resolved.protectedSpanKinds).not.toContain('scripture');
	});
});
