import { Rule, Severity } from './types';

// A user-editable config the plugin loads from the vault (.plumbline/config.json),
// so the ruleset is tunable without touching code. It can disable a built-in rule
// by slug, override a built-in rule's severity/message/phrases, or add new rules.
// This is the first slice of the pack/profile cascade (see config-model.md);
// YAML authoring and per-profile overrides come later.

export interface RuleOverride {
	severity?: Severity;
	message?: string;
	phrases?: string[];
}

export interface VaultConfig {
	disabledRules: string[];
	rules: Rule[];
	overrides: Record<string, RuleOverride>;
}

export const EMPTY_VAULT_CONFIG: VaultConfig = {
	disabledRules: [],
	rules: [],
	overrides: {},
};

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((v): v is string => typeof v === 'string');
}

function asSeverity(value: unknown): Severity | undefined {
	if (value === 'error' || value === 'warning' || value === 'suggestion') {
		return value;
	}
	return undefined;
}

function asRule(value: unknown): Rule | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}
	const obj = value as Record<string, unknown>;
	const severity = asSeverity(obj.severity);
	if (
		typeof obj.slug !== 'string' ||
		obj.slug.length === 0 ||
		typeof obj.message !== 'string' ||
		!severity
	) {
		return null;
	}
	return {
		slug: obj.slug,
		packId: typeof obj.packId === 'string' ? obj.packId : 'custom',
		category: typeof obj.category === 'string' ? obj.category : 'custom',
		severity,
		message: obj.message,
		phrases: asStringArray(obj.phrases),
	};
}

function asOverrides(value: unknown): Record<string, RuleOverride> {
	const result: Record<string, RuleOverride> = {};
	if (typeof value !== 'object' || value === null) {
		return result;
	}
	for (const [slug, raw] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (typeof raw !== 'object' || raw === null) {
			continue;
		}
		const obj = raw as Record<string, unknown>;
		const override: RuleOverride = {};
		const severity = asSeverity(obj.severity);
		if (severity) {
			override.severity = severity;
		}
		if (typeof obj.message === 'string') {
			override.message = obj.message;
		}
		if (Array.isArray(obj.phrases)) {
			override.phrases = asStringArray(obj.phrases);
		}
		result[slug] = override;
	}
	return result;
}

// Parse untrusted JSON from disk into a VaultConfig, dropping anything malformed
// rather than throwing. Unknown fields and bad entries are ignored.
export function parseVaultConfig(raw: unknown): VaultConfig {
	if (typeof raw !== 'object' || raw === null) {
		return { ...EMPTY_VAULT_CONFIG };
	}
	const obj = raw as Record<string, unknown>;
	return {
		disabledRules: asStringArray(obj.disabledRules),
		rules: Array.isArray(obj.rules)
			? obj.rules.map(asRule).filter((r): r is Rule => r !== null)
			: [],
		overrides: asOverrides(obj.overrides),
	};
}

// Apply the vault config over the built-in rules: drop disabled slugs, override
// matching rules, then append the custom rules (also honoring the disabled set).
export function mergeRules(builtin: Rule[], config: VaultConfig): Rule[] {
	const disabled = new Set(config.disabledRules);
	const merged = builtin
		.filter((rule) => !disabled.has(rule.slug))
		.map((rule) => {
			const override = config.overrides[rule.slug];
			if (!override) {
				return rule;
			}
			return {
				...rule,
				severity: override.severity ?? rule.severity,
				message: override.message ?? rule.message,
				phrases: override.phrases ?? rule.phrases,
			};
		});
	const custom = config.rules.filter((rule) => !disabled.has(rule.slug));
	return [...merged, ...custom];
}
