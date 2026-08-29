import { ResolvedConfig } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';
import { BASE_RULES } from './packs';

// Minimal config resolver. Until the full pack and profile cascade lands (see
// config-model.md), every profile resolves to the base protected-span kinds and
// the base pack's rules. This is the one call site the plugin uses, so swapping
// in the real cascade later touches nothing else.
export function resolveConfig(profileId: string): ResolvedConfig {
	return {
		profileId,
		protectedSpanKinds: [...BASE_SPAN_KINDS],
		rules: [...BASE_RULES],
	};
}
