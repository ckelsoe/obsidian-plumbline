import { ResolvedConfig, Rule, Severity } from './types';
import { ANNOTECA_COMMENT_KIND, HTML_COMMENT_KIND } from './protected-spans';
import { HEURISTIC_RULES } from './heuristics';
import { VaultConfig, mergeRules } from './vault-config';
import {
	GroupDefinition,
	starterGroup,
	fallbackGroup,
	resolveGroup,
	groupPackRules,
	groupSpanKinds,
} from './groups';

// This module turns a group id into the ResolvedConfig the engine consumes. The
// group model (groups.ts) supplies which packs and checks are active; the vault
// config is the tuning layer applied on top, unchanged from before groups
// existed. See config-model.md.

// The identity of one toggleable rule, for the settings list. Both mechanical
// rules and the cross-sentence heuristics share these fields; the heuristics also
// carry a run() the settings list does not need.
export interface RuleInfo {
	slug: string;
	packId: string;
	severity: Severity;
	message: string;
}

// One toggleable protected-span kind, for the settings list. Only the comment
// kinds are user-facing; code, heading, and frontmatter masking stay always on,
// since a rule firing inside code or a heading is never wanted.
export interface SpanKindInfo {
	kind: string;
	name: string;
	desc: string;
}

export const COMMENT_SPAN_KINDS: SpanKindInfo[] = [
	{
		kind: ANNOTECA_COMMENT_KIND,
		name: 'Annoteca comments',
		desc: "Skip text inside Annoteca's comment markers.",
	},
	{
		kind: HTML_COMMENT_KIND,
		name: 'Other HTML comments',
		desc: 'Skip text inside plain HTML comments.',
	},
];

// The group behind a group id, with the devotional starter as the fallback for an
// unknown id so a stale note or a fresh install still resolves to something
// sensible. The parameter is named profileId because the note-level selector is
// still spelled `plumbline-profile`; the value it carries is a group id.
function groupFor(profileId: string): GroupDefinition {
	return starterGroup(profileId) ?? fallbackGroup();
}

// The built-in mechanical rules a group activates, before any vault config is
// applied. Its own step rather than being inlined into resolveConfig.
export function profileRules(profileId: string): Rule[] {
	return groupPackRules(groupFor(profileId));
}

function toRuleInfo(rule: RuleInfo): RuleInfo {
	return {
		slug: rule.slug,
		packId: rule.packId,
		severity: rule.severity,
		message: rule.message,
	};
}

// Every toggleable built-in rule for a group: the mechanical rules plus the
// cross-sentence heuristics (which apply to every group). The settings tab lists
// these, so a heuristic is disableable through the same UI and disabled set as a
// phrase rule.
export function profileRuleInfos(profileId: string): RuleInfo[] {
	return [
		...profileRules(profileId).map(toRuleInfo),
		...HEURISTIC_RULES.map(toRuleInfo),
	];
}

// The protected-span kinds a group activates. Every group masks the base kinds;
// the devotional group also masks quoted verses.
export function profileSpanKinds(profileId: string): string[] {
	return groupSpanKinds(groupFor(profileId));
}

// Resolve the active group for a group id, then apply the user's vault config
// (disable/override/add, span toggles, volume) on top. This is the one call site
// the plugin uses.
export function resolveConfig(
	profileId: string,
	vaultConfig?: VaultConfig,
): ResolvedConfig {
	const group = groupFor(profileId);
	const base = resolveGroup(group);

	const disabledKinds = new Set(vaultConfig?.disabledSpanKinds ?? []);
	const protectedSpanKinds = base.protectedSpanKinds.filter(
		(kind) => !disabledKinds.has(kind),
	);

	let rules = base.rules;
	let disabledSlugs = base.disabledSlugs;
	if (vaultConfig) {
		rules = mergeRules(rules, vaultConfig);
		disabledSlugs = [...base.disabledSlugs, ...vaultConfig.disabledRules];
	}

	return {
		profileId: group.id,
		protectedSpanKinds,
		rules,
		disabledSlugs,
		rollupThreshold: vaultConfig?.rollupThreshold ?? base.rollupThreshold,
		confidenceBySlug: {
			...base.confidenceBySlug,
			...(vaultConfig?.confidence ?? {}),
		},
	};
}
