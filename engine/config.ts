import { ResolvedConfig, Rule, Severity } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';
import { BASE_RULES } from './packs';
import { SCRIPTURE_SPAN_KIND, SCRIPTURE_RULES } from './scripture';
import { HEURISTIC_RULES } from './heuristics';
import { VaultConfig, mergeRules } from './vault-config';

// The profile whose packs include scripture. Until the full pack and profile
// cascade lands (see config-model.md), profiles are resolved here directly.
const SCRIPTURE_PROFILE = 'scripture-book';

// The identity of one toggleable rule, for the settings list. Both mechanical
// rules and the cross-sentence heuristics share these fields; the heuristics also
// carry a run() the settings list does not need.
export interface RuleInfo {
	slug: string;
	packId: string;
	severity: Severity;
	message: string;
}

// The built-in mechanical rules a profile activates, before any vault config is
// applied. Exported as its own step rather than being inlined into resolveConfig.
export function profileRules(profileId: string): Rule[] {
	if (profileId === SCRIPTURE_PROFILE) {
		return [...BASE_RULES, ...SCRIPTURE_RULES];
	}
	return [...BASE_RULES];
}

function toRuleInfo(rule: RuleInfo): RuleInfo {
	return {
		slug: rule.slug,
		packId: rule.packId,
		severity: rule.severity,
		message: rule.message,
	};
}

// Every toggleable built-in rule for a profile: the mechanical rules plus the
// cross-sentence heuristics (which apply to every profile). The settings tab
// lists these, so a heuristic is disableable through the same UI and disabled set
// as a phrase rule.
export function profileRuleInfos(profileId: string): RuleInfo[] {
	return [
		...profileRules(profileId).map(toRuleInfo),
		...HEURISTIC_RULES.map(toRuleInfo),
	];
}

// The protected-span kinds a profile activates. Every profile masks the base
// kinds; the scripture profile also masks quoted verses.
export function profileSpanKinds(profileId: string): string[] {
	const kinds: string[] = [...BASE_SPAN_KINDS];
	if (profileId === SCRIPTURE_PROFILE) {
		kinds.push(SCRIPTURE_SPAN_KIND);
	}
	return kinds;
}

// Resolve the active rules for a profile, then apply the user's vault config
// (disable/override/add) on top. This is the one call site the plugin uses.
export function resolveConfig(
	profileId: string,
	vaultConfig?: VaultConfig,
): ResolvedConfig {
	const protectedSpanKinds = profileSpanKinds(profileId);
	let rules = profileRules(profileId);
	if (vaultConfig) {
		rules = mergeRules(rules, vaultConfig);
	}
	return {
		profileId,
		protectedSpanKinds,
		rules,
		disabledSlugs: vaultConfig ? [...vaultConfig.disabledRules] : [],
	};
}
