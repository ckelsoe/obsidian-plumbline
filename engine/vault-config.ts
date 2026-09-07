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
	// Volume tuning (PL-B). Both optional: a config file written before these
	// existed resolves to the built-in defaults.
	rollupThreshold?: number;
	// Per-rule confidence, slug to 0..1. Clamped when it is read, because this
	// file is hand-edited and a negative or huge value would invert the ranking.
	confidence?: Record<string, number>;
	// Protected-span kinds the user turned off, so a rule can once again fire
	// inside them (the comment kinds are the ones exposed as toggles).
	disabledSpanKinds: string[];
	rules: Rule[];
	overrides: Record<string, RuleOverride>;
}

export const EMPTY_VAULT_CONFIG: VaultConfig = {
	disabledRules: [],
	disabledSpanKinds: [],
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

// A finite, non-negative integer, or undefined. Used for rollupThreshold, where
// a string, NaN or a negative would otherwise reach the ranking maths.
function asPositiveInt(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
		return undefined;
	}
	return Math.floor(value);
}

// Per-rule confidence, slug to 0..1. Entries that are not finite numbers are
// dropped; values outside the range are clamped rather than dropped, because a
// user writing 2 means "trust this a lot" and the nearest legal reading of that
// is 1, not "ignore what I wrote".
function asConfidence(value: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (typeof value !== 'object' || value === null) {
		return out;
	}
	for (const [slug, raw] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (typeof raw === 'number' && Number.isFinite(raw)) {
			out[slug] = Math.min(1, Math.max(0, raw));
		}
	}
	return out;
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
		disabledSpanKinds: asStringArray(obj.disabledSpanKinds),
		rules: Array.isArray(obj.rules)
			? obj.rules.map(asRule).filter((r): r is Rule => r !== null)
			: [],
		overrides: asOverrides(obj.overrides),
		rollupThreshold: asPositiveInt(obj.rollupThreshold),
		confidence: asConfidence(obj.confidence),
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
