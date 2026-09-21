import { ResolvedConfig, Rule, Severity } from './types';
import { ANNOTECA_COMMENT_KIND, HTML_COMMENT_KIND } from './protected-spans';
import { HEURISTIC_RULES } from './heuristics';
import { BASE_RULES } from './packs';
import { SCRIPTURE_RULES } from './scripture';
import { CONFIDENCE } from './rollup';
import { VaultConfig, mergeRules } from './vault-config';
import {
	GroupDefinition,
	fallbackGroup,
	resolveGroup,
	groupPackRules,
	groupSpanKinds,
} from './groups';
import { findGroup } from './group-store';
import { CustomCheck, customCheckToRule } from './check-store';

// This module turns a group id into the ResolvedConfig the engine consumes. The
// group model (groups.ts) supplies which packs and checks are active; the vault
// config is the tuning layer applied on top, unchanged from before groups
// existed. See config-model.md.

// A check slug as a readable, sentence-case label ('reader-direction' ->
// 'Reader direction'). The one place this derivation lives, so a built-in check's
// label matches wherever the plugin and the settings tab show it.
export function prettifySlug(slug: string): string {
	const spaced = slug.replace(/-/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

// The group behind a group id, across the built-in starters and the user's own
// groups, with the base-only group as the fallback for an unknown id so a stale
// note or a fresh install still resolves to something sensible. The parameter is
// named profileId because the note-level selector is still spelled
// `plumbline-profile`; the value it carries is a group id. `userGroups` is the
// vault's groups.json (empty for a caller that only knows the built-ins).
function groupFor(
	profileId: string,
	userGroups: readonly GroupDefinition[] = [],
): GroupDefinition {
	return findGroup(profileId, userGroups) ?? fallbackGroup();
}

// The built-in mechanical rules a group activates, before any vault config is
// applied. Its own step rather than being inlined into resolveConfig.
export function profileRules(
	profileId: string,
	userGroups: readonly GroupDefinition[] = [],
): Rule[] {
	return groupPackRules(groupFor(profileId, userGroups));
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
export function profileRuleInfos(
	profileId: string,
	userGroups: readonly GroupDefinition[] = [],
): RuleInfo[] {
	return [
		...profileRules(profileId, userGroups).map(toRuleInfo),
		...HEURISTIC_RULES.map(toRuleInfo),
	];
}

// The protected-span kinds a group activates. Every group masks the base kinds;
// the devotional group also masks quoted verses.
export function profileSpanKinds(
	profileId: string,
	userGroups: readonly GroupDefinition[] = [],
): string[] {
	return groupSpanKinds(groupFor(profileId, userGroups));
}

// Resolve the active group for a group id, then apply the user's vault config
// (disable/override/add, span toggles, volume) on top. This is the one call site
// the plugin uses. `customChecks` are the vault's library entries, resolved into
// the group (each on only where a membership enables it) before the flat config.
export function resolveConfig(
	profileId: string,
	vaultConfig?: VaultConfig,
	userGroups: readonly GroupDefinition[] = [],
	customChecks: readonly CustomCheck[] = [],
): ResolvedConfig {
	const group = groupFor(profileId, userGroups);
	const base = resolveGroup(group, customChecks.map(customCheckToRule));

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

	// A heuristic's severity override from the flat vault config lands in
	// severityBySlug, because mergeRules only retunes the mechanical rule list; a
	// heuristic is not in `rules`, so its stored override would otherwise never
	// take effect. A mechanical override is already baked into `rules` above, so it
	// is not copied here (that would be a dead entry the engine ignores anyway).
	const heuristicSlugs = new Set(HEURISTIC_RULES.map((r) => r.slug));
	const severityBySlug: Record<string, Severity> = { ...base.severityBySlug };
	if (vaultConfig) {
		for (const [slug, override] of Object.entries(vaultConfig.overrides)) {
			if (override.severity && heuristicSlugs.has(slug)) {
				severityBySlug[slug] = override.severity;
			}
		}
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
		severityBySlug,
		// The flat vault config has no per-check roll-up layer; that override lives
		// on the group membership only, so the group's map passes straight through.
		rollupBySlug: base.rollupBySlug,
	};
}

// One check the library and the check editor render: its identity, its origin, and
// the defaults a group membership overrides. It carries the DEFAULT severity and
// confidence (the check's own value), not the effective one; the settings tab
// layers the active group's membership over it. A built-in check derives its label
// from the slug, so `name` is set only for a custom check. See config-model.md,
// "One library, named groups".
export interface CheckDescriptor {
	slug: string;
	packId: string;
	category: string;
	message: string;
	defaultSeverity: Severity;
	defaultConfidence: number;
	// A cross-sentence heuristic rather than a phrase rule. Heuristics belong to
	// the base pack and apply to every group, so their availability does not depend
	// on `extends`.
	isHeuristic: boolean;
	// A user library entry (check-store) rather than a built-in pack check. Custom
	// checks default OFF in a group and their matching is editable.
	isCustom: boolean;
	// Editable display name for a custom check; undefined for a built-in.
	name?: string;
}

function mechanicalDescriptor(rule: Rule): CheckDescriptor {
	return {
		slug: rule.slug,
		packId: rule.packId,
		category: rule.category,
		message: rule.message,
		defaultSeverity: rule.severity,
		defaultConfidence: rule.confidence ?? CONFIDENCE.mechanical,
		isHeuristic: false,
		isCustom: false,
	};
}

function customDescriptor(check: CustomCheck): CheckDescriptor {
	return {
		slug: check.slug,
		packId: check.category,
		category: check.category,
		message: check.message,
		defaultSeverity: check.severity,
		defaultConfidence: check.confidence ?? CONFIDENCE.mechanical,
		isHeuristic: false,
		isCustom: true,
		name: check.name,
	};
}

// A heuristic's descriptor. Its category is the constant 'heuristic' (heuristics
// carry no A-H tag), and it falls back to the heuristic-tier confidence rather than
// the mechanical one. Shared by the two catalogue builders below so the mapping
// cannot drift.
function heuristicDescriptor(
	rule: (typeof HEURISTIC_RULES)[number],
): CheckDescriptor {
	return {
		slug: rule.slug,
		packId: rule.packId,
		category: 'heuristic',
		message: rule.message,
		defaultSeverity: rule.severity,
		defaultConfidence: rule.confidence ?? CONFIDENCE.heuristic,
		isHeuristic: true,
		isCustom: false,
	};
}

// Every built-in check's descriptor: the base and scripture phrase rules plus the
// cross-sentence heuristics, in a stable order. This is the whole built-in
// catalogue regardless of any group, so describeCheck can resolve a slug that a
// specific group does not draw (a scripture check looked up from a base group).
function builtinCheckDescriptors(): CheckDescriptor[] {
	return [
		...BASE_RULES.map(mechanicalDescriptor),
		...SCRIPTURE_RULES.map(mechanicalDescriptor),
		...HEURISTIC_RULES.map(heuristicDescriptor),
	];
}

// The descriptors relevant to a group's library view: the pack checks the group
// extends (heuristics always, scripture phrase rules only when the pack is on),
// plus every custom check (custom checks are pack-independent, so the whole library
// is offered regardless of `extends`). The active-rules list filters this to the
// enabled ones; the library picker shows all of them with a tick.
export function groupCheckDescriptors(
	group: GroupDefinition,
	customChecks: readonly CustomCheck[] = [],
): CheckDescriptor[] {
	return [
		...groupPackRules(group).map(mechanicalDescriptor),
		...HEURISTIC_RULES.map(heuristicDescriptor),
		...customChecks.map(customDescriptor),
	];
}

// Locate one check's descriptor across the built-in catalogue and the custom
// checks, or undefined when the slug is unknown. The check editor and the
// "in groups" readout resolve a slug through this.
export function describeCheck(
	slug: string,
	customChecks: readonly CustomCheck[] = [],
): CheckDescriptor | undefined {
	const custom = customChecks.find((check) => check.slug === slug);
	if (custom) {
		return customDescriptor(custom);
	}
	return builtinCheckDescriptors().find(
		(descriptor) => descriptor.slug === slug,
	);
}

// Whether a check is on within a group. A custom check is on only where a
// membership enables it (default OFF); a built-in is on unless a membership turns
// it off, and a pack phrase rule additionally needs its pack in the group's
// `extends`. Heuristics belong to the base pack, which every group carries. This is
// the one place the enabled cascade lives, shared by the active-rules list, the
// library tick, and the "in groups" readout.
export function isCheckEnabledInGroup(
	group: GroupDefinition,
	descriptor: CheckDescriptor,
): boolean {
	const membership = group.checks[descriptor.slug];
	if (descriptor.isCustom) {
		return membership?.enabled === true;
	}
	const inScope =
		descriptor.isHeuristic || group.extends.includes(descriptor.packId);
	return inScope && membership?.enabled !== false;
}
