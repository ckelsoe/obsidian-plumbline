import {
	parseUserGroups,
	serializeUserGroups,
	findGroup,
	allGroups,
	hasFlatTuning,
	buildMigratedGroup,
} from '../engine/group-store';
import { resolveConfig } from '../engine/config';
import {
	GroupDefinition,
	DEVOTIONAL_NONFICTION_ID,
	PLAIN_NONFICTION_ID,
	starterGroup,
} from '../engine/groups';
import { EMPTY_VAULT_CONFIG, VaultConfig } from '../engine/vault-config';

const userGroup = (over: Partial<GroupDefinition> = {}): GroupDefinition => ({
	id: 'my-fiction',
	name: 'My fiction',
	builtIn: false,
	extends: ['base'],
	rollupThreshold: 4,
	checks: {},
	...over,
});

describe('parseUserGroups', () => {
	it('returns an empty list for anything that is not an array', () => {
		expect(parseUserGroups(null)).toEqual([]);
		expect(parseUserGroups({})).toEqual([]);
		expect(parseUserGroups('nope')).toEqual([]);
	});

	it('parses a well-formed group and forces builtIn false', () => {
		const [g] = parseUserGroups([
			{
				id: 'my-fiction',
				name: 'My fiction',
				builtIn: true,
				extends: ['base'],
				rollupThreshold: 6,
				checks: { 'reader-direction': { enabled: false } },
			},
		]);
		expect(g?.builtIn).toBe(false);
		expect(g?.rollupThreshold).toBe(6);
		expect(g?.checks['reader-direction']).toEqual({ enabled: false });
	});

	it('keeps only well-typed membership fields', () => {
		const [g] = parseUserGroups([
			{
				id: 'my-fiction',
				name: 'My fiction',
				checks: {
					a: {
						enabled: 'yes',
						severity: 'loud',
						confidence: 'high',
						rollup: 2,
					},
					b: { severity: 'error', confidence: 0.4 },
				},
			},
		]);
		// enabled/severity/confidence were the wrong type and dropped; rollup kept.
		expect(g?.checks.a).toEqual({ rollup: 2 });
		expect(g?.checks.b).toEqual({ severity: 'error', confidence: 0.4 });
	});

	it('drops a group with no id or no name', () => {
		expect(parseUserGroups([{ name: 'no id' }, { id: 'no-name' }])).toEqual(
			[],
		);
	});

	it('drops a group whose id collides with a starter or the legacy alias', () => {
		const parsed = parseUserGroups([
			{ id: DEVOTIONAL_NONFICTION_ID, name: 'Shadow' },
			{ id: 'scripture-book', name: 'Legacy shadow' },
			{ id: 'my-fiction', name: 'Mine' },
		]);
		expect(parsed.map((g) => g.id)).toEqual(['my-fiction']);
	});

	it('keeps the first of two groups sharing an id', () => {
		const parsed = parseUserGroups([
			{ id: 'dup', name: 'First' },
			{ id: 'dup', name: 'Second' },
		]);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.name).toBe('First');
	});

	it('defaults a bad rollup threshold to the engine default', () => {
		const [g] = parseUserGroups([
			{ id: 'x', name: 'X', rollupThreshold: 'lots' },
		]);
		expect(g?.rollupThreshold).toBe(4);
	});
});

describe('serializeUserGroups', () => {
	it('round-trips a group without writing builtIn', () => {
		const group = userGroup({ checks: { a: { severity: 'warning' } } });
		const json = serializeUserGroups([group]);
		expect(json).not.toContain('builtIn');
		const [back] = parseUserGroups(JSON.parse(json));
		expect(back).toEqual(group);
	});
});

describe('findGroup and allGroups', () => {
	const groups = [userGroup()];

	it('resolves a starter, the legacy alias, and a user group', () => {
		expect(findGroup(DEVOTIONAL_NONFICTION_ID, groups)?.id).toBe(
			DEVOTIONAL_NONFICTION_ID,
		);
		expect(findGroup('scripture-book', groups)?.id).toBe(
			DEVOTIONAL_NONFICTION_ID,
		);
		expect(findGroup('my-fiction', groups)?.name).toBe('My fiction');
		expect(findGroup('nope', groups)).toBeUndefined();
	});

	it('lists the starters first, then the user groups', () => {
		expect(allGroups(groups).map((g) => g.id)).toEqual([
			DEVOTIONAL_NONFICTION_ID,
			PLAIN_NONFICTION_ID,
			'my-fiction',
		]);
	});
});

describe('resolveConfig with a user group', () => {
	it('resolves a user group id, honouring its membership tuning', () => {
		const groups = [
			userGroup({
				id: 'my-fiction',
				checks: { 'reader-direction': { enabled: false } },
			}),
		];
		const resolved = resolveConfig('my-fiction', undefined, groups);
		expect(resolved.profileId).toBe('my-fiction');
		expect(resolved.disabledSlugs).toContain('reader-direction');
	});

	it('falls back to the base-only group for an unknown id', () => {
		expect(resolveConfig('ghost', undefined, []).profileId).toBe(
			PLAIN_NONFICTION_ID,
		);
	});
});

const vaultConfig = (over: Partial<VaultConfig> = {}): VaultConfig => ({
	...EMPTY_VAULT_CONFIG,
	overrides: {},
	confidence: {},
	...over,
});

describe('hasFlatTuning', () => {
	it('is false for an empty vault config', () => {
		expect(hasFlatTuning(vaultConfig())).toBe(false);
	});

	it('is true for a rule toggle, a severity override, a threshold, or confidence', () => {
		expect(hasFlatTuning(vaultConfig({ disabledRules: ['a'] }))).toBe(true);
		expect(hasFlatTuning(vaultConfig({ rollupThreshold: 6 }))).toBe(true);
		expect(hasFlatTuning(vaultConfig({ confidence: { a: 0.2 } }))).toBe(
			true,
		);
		expect(
			hasFlatTuning(
				vaultConfig({ overrides: { a: { severity: 'error' } } }),
			),
		).toBe(true);
	});

	it('is false for a message-only override, which is not tuning it migrates', () => {
		expect(
			hasFlatTuning(vaultConfig({ overrides: { a: { message: 'hi' } } })),
		).toBe(false);
	});
});

describe('buildMigratedGroup', () => {
	const devotional = starterGroup(DEVOTIONAL_NONFICTION_ID);
	if (!devotional) {
		throw new Error('missing devotional starter');
	}

	it('folds flat tuning into membership and clones the starter', () => {
		const migrated = buildMigratedGroup(
			devotional,
			vaultConfig({
				disabledRules: ['cinematic-opener'],
				rollupThreshold: 6,
				confidence: { anaphora: 0.2 },
				overrides: {
					'reader-direction': { severity: 'error' },
					// A message-only override is not membership tuning, so it does
					// not become a check membership here.
					'summative-closer': { message: 'custom' },
				},
			}),
			'devotional-nonfiction-2',
		);
		expect(migrated.id).toBe('devotional-nonfiction-2');
		expect(migrated.builtIn).toBe(false);
		expect(migrated.name).toBe('Devotional nonfiction (my copy)');
		expect(migrated.extends).toEqual(devotional.extends);
		expect(migrated.rollupThreshold).toBe(6);
		expect(migrated.checks['cinematic-opener']).toEqual({ enabled: false });
		expect(migrated.checks['reader-direction']).toEqual({
			severity: 'error',
		});
		expect(migrated.checks.anaphora).toEqual({ confidence: 0.2 });
		expect(migrated.checks['summative-closer']).toBeUndefined();
	});

	it('keeps the starter threshold when the config sets none', () => {
		const migrated = buildMigratedGroup(
			devotional,
			vaultConfig({ disabledRules: ['anaphora'] }),
			'x',
		);
		expect(migrated.rollupThreshold).toBe(devotional.rollupThreshold);
	});
});
