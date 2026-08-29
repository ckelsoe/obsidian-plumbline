import { ResolvedConfig } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';
import { BASE_RULES } from './packs';
import { SCRIPTURE_SPAN_KIND, SCRIPTURE_RULES } from './scripture';

// The profile whose packs include scripture. Until the full pack and profile
// cascade lands (see config-model.md), profiles are resolved here directly.
const SCRIPTURE_PROFILE = 'scripture-book';

// Minimal config resolver. Every profile gets the base protected-span kinds and
// the base pack's rules; the scripture profile adds the scripture span source and
// the scripture pack's rules. This is the one call site the plugin uses, so
// swapping in the real cascade later touches nothing else.
export function resolveConfig(profileId: string): ResolvedConfig {
	const protectedSpanKinds: string[] = [...BASE_SPAN_KINDS];
	const rules = [...BASE_RULES];
	if (profileId === SCRIPTURE_PROFILE) {
		protectedSpanKinds.push(SCRIPTURE_SPAN_KIND);
		rules.push(...SCRIPTURE_RULES);
	}
	return { profileId, protectedSpanKinds, rules };
}
