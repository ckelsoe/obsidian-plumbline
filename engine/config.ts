import { ResolvedConfig } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';

// Minimal config resolver. Until the pack and profile cascade lands (see
// config-model.md), every profile resolves to the base protected-span kinds and
// no rules. This exists so the engine has a real config to run against and the
// plugin has one call site to swap when the cascade arrives.
export function resolveConfig(profileId: string): ResolvedConfig {
	return {
		profileId,
		protectedSpanKinds: [...BASE_SPAN_KINDS],
	};
}
