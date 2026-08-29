import {
	parseVaultConfig,
	mergeRules,
	EMPTY_VAULT_CONFIG,
} from '../engine/vault-config';
import { Rule } from '../engine/types';

const builtin: Rule[] = [
	{
		slug: 'reader-direction',
		packId: 'base',
		category: 'A',
		severity: 'warning',
		message: 'Cut it.',
		phrases: ['read that again'],
	},
	{
		slug: 'flagged-register',
		packId: 'base',
		category: 'C',
		severity: 'warning',
		message: 'Plain word.',
		phrases: ['delve'],
	},
];

describe('parseVaultConfig', () => {
	it('returns empty config for non-objects', () => {
		expect(parseVaultConfig(null)).toEqual(EMPTY_VAULT_CONFIG);
		expect(parseVaultConfig('nope')).toEqual(EMPTY_VAULT_CONFIG);
	});

	it('parses fields and drops malformed entries', () => {
		const config = parseVaultConfig({
			disabledRules: ['cinematic-opener', 42],
			overrides: {
				'flagged-register': { severity: 'suggestion' },
				bad: 'nope',
			},
			rules: [
				{
					slug: 'my-rule',
					severity: 'warning',
					message: 'x',
					phrases: ['foo'],
				},
				{ slug: '', severity: 'warning', message: 'y', phrases: [] },
				'garbage',
			],
		});
		expect(config.disabledRules).toEqual(['cinematic-opener']);
		expect(config.overrides['flagged-register']?.severity).toBe(
			'suggestion',
		);
		expect(config.overrides.bad).toBeUndefined();
		expect(config.rules).toHaveLength(1);
		expect(config.rules[0]?.slug).toBe('my-rule');
	});
});

describe('mergeRules', () => {
	it('disables a rule by slug', () => {
		const merged = mergeRules(builtin, {
			...EMPTY_VAULT_CONFIG,
			disabledRules: ['flagged-register'],
		});
		expect(merged.map((r) => r.slug)).toEqual(['reader-direction']);
	});

	it('overrides a rule severity and phrases', () => {
		const merged = mergeRules(builtin, {
			...EMPTY_VAULT_CONFIG,
			overrides: {
				'flagged-register': {
					severity: 'suggestion',
					phrases: ['delve', 'tapestry'],
				},
			},
		});
		const rule = merged.find((r) => r.slug === 'flagged-register');
		expect(rule?.severity).toBe('suggestion');
		expect(rule?.phrases).toEqual(['delve', 'tapestry']);
	});

	it('appends custom rules', () => {
		const custom: Rule = {
			slug: 'my-rule',
			packId: 'custom',
			category: 'C',
			severity: 'warning',
			message: 'x',
			phrases: ['foo'],
		};
		const merged = mergeRules(builtin, {
			...EMPTY_VAULT_CONFIG,
			rules: [custom],
		});
		expect(merged.map((r) => r.slug)).toContain('my-rule');
	});
});
