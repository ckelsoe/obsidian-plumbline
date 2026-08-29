import { ResolvedConfig } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';
import { BASE_RULES } from './packs';
import { SCRIPTURE_SPAN_KIND, SCRIPTURE_RULES } from './scripture';
import { VaultConfig, mergeRules } from './vault-config';

// The profile whose packs include scripture. Until the full pack and profile
// cascade lands (see config-model.md), profiles are resolved here directly.
const SCRIPTURE_PROFILE = 'scripture-book';

// Resolve the active rules for a profile, then apply the user's vault config
// (disable/override/add) on top. Every profile gets the base protected-span kinds
// and base rules; the scripture profile also adds the scripture span source and
// rules. This is the one call site the plugin uses.
export function resolveConfig(
	profileId: string,
	vaultConfig?: VaultConfig,
): ResolvedConfig {
	const protectedSpanKinds: string[] = [...BASE_SPAN_KINDS];
	let rules = [...BASE_RULES];
	if (profileId === SCRIPTURE_PROFILE) {
		protectedSpanKinds.push(SCRIPTURE_SPAN_KIND);
		rules = [...rules, ...SCRIPTURE_RULES];
	}
	if (vaultConfig) {
		rules = mergeRules(rules, vaultConfig);
	}
	return { profileId, protectedSpanKinds, rules };
}
