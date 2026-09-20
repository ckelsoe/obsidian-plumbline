import { ResolvedConfig, Rule, Severity } from './types';
import { BASE_SPAN_KINDS } from './protected-spans';
import { BASE_RULES, BASE_PACK_ID } from './packs';
import {
	SCRIPTURE_RULES,
	SCRIPTURE_PACK_ID,
	SCRIPTURE_SPAN_KIND,
} from './scripture';
import { HEURISTIC_RULES } from './heuristics';
import { DEFAULT_ROLLUP_THRESHOLD } from './rollup';

// A group is the user-facing composition unit: a named bundle that turns a subset
// of the library on and tunes it. It is what earlier sections of config-model.md
// call a profile, resolved at check granularity rather than by whole packs. The
// engine never sees a group; a group resolves into the ResolvedConfig the engine
// consumes. See config-model.md, "Groups, the check library, and per-membership
// tuning".

// One check's membership in a group. Every field is optional: a membership records
// a value only where it overrides the check default, so a group definition stays
// sparse. `enabled` defaults to true, so a check in an extended pack is on unless
// the membership turns it off.
export interface CheckMembership {
	enabled?: boolean;
	// Overrides the check's default severity. Applied to mechanical rules here;
	// heuristic severity override is a later phase (it changes the calibrated
	// ranking), so a membership severity on a heuristic slug is ignored for now.
	severity?: Severity;
	// Overrides the check's default confidence, 0..1. Clamped on read.
	confidence?: number;
	// Per-check roll-up override is a later phase; the calibrated roll-up is not
	// tuned per check yet, so this field is reserved and not read.
	rollup?: number;
}

// A named, applicable bundle. `extends` lists the packs it draws from; `checks`
// records only the deviations from those packs' defaults.
export interface GroupDefinition {
	id: string;
	name: string;
	// Starter groups ship read-only. A user clones one to get an editable copy.
	builtIn: boolean;
	extends: string[];
	rollupThreshold: number;
	checks: Record<string, CheckMembership>;
}

export const DEVOTIONAL_NONFICTION_ID = 'devotional-nonfiction';
export const PLAIN_NONFICTION_ID = 'plain-nonfiction';

// The mechanical rules and the extra protected-span kind each pack contributes.
// Every group extends the base pack, whose span kinds (code, headings,
// frontmatter, comments) are always on and are added up front, so the base pack
// contributes no extra span here. The cross-sentence heuristics belong to the
// base pack too but apply to every group regardless of `extends`, so they are
// added separately below, not through this map.
const PACK_MECHANICAL: Record<string, Rule[]> = {
	[BASE_PACK_ID]: BASE_RULES,
	[SCRIPTURE_PACK_ID]: SCRIPTURE_RULES,
};

const PACK_EXTRA_SPAN_KINDS: Record<string, string[]> = {
	[SCRIPTURE_PACK_ID]: [SCRIPTURE_SPAN_KIND],
};

const HEURISTIC_SLUGS: ReadonlySet<string> = new Set(
	HEURISTIC_RULES.map((rule) => rule.slug),
);

// The built-in starter groups. Their `checks` maps are empty: each turns on every
// check in the packs it extends at that check's default tuning, which is exactly
// what the single hardcoded profile did before groups existed. Devotional
// nonfiction reproduces the former `scripture-book` profile; plain nonfiction is
// the base pack on its own.
const DEVOTIONAL_NONFICTION: GroupDefinition = {
	id: DEVOTIONAL_NONFICTION_ID,
	name: 'Devotional nonfiction',
	builtIn: true,
	extends: [BASE_PACK_ID, SCRIPTURE_PACK_ID],
	rollupThreshold: DEFAULT_ROLLUP_THRESHOLD,
	checks: {},
};

const PLAIN_NONFICTION: GroupDefinition = {
	id: PLAIN_NONFICTION_ID,
	name: 'Plain nonfiction',
	builtIn: true,
	extends: [BASE_PACK_ID],
	rollupThreshold: DEFAULT_ROLLUP_THRESHOLD,
	checks: {},
};

export const STARTER_GROUPS: readonly GroupDefinition[] = [
	DEVOTIONAL_NONFICTION,
	PLAIN_NONFICTION,
];

// The former id of the devotional group, before the rename off "Scripture book".
// A note's `plumbline-profile` frontmatter or a stored setting written under the
// old id still resolves to the devotional group.
const LEGACY_DEVOTIONAL_ID = 'scripture-book';

// The group the resolver falls back to for an unknown group id, matching the old
// behaviour where an unrecognised profile got the base pack alone. A note tagged
// with a genre whose pack does not exist yet (fiction, technical) gets the
// universal checks, never another genre's integrity rules. This is distinct from
// the fresh-install default, which is the devotional flagship (DEFAULT_SETTINGS).
export function fallbackGroup(): GroupDefinition {
	return PLAIN_NONFICTION;
}

// The starter group for an id, or undefined. The legacy `scripture-book` id maps
// to the devotional group so pre-rename configs and notes still resolve.
export function starterGroup(id: string): GroupDefinition | undefined {
	if (id === LEGACY_DEVOTIONAL_ID) {
		return DEVOTIONAL_NONFICTION;
	}
	return STARTER_GROUPS.find((g) => g.id === id);
}

// Rewrite a stored group id to its current spelling, so a setting saved before
// the rename shows the right group selected. Only the known legacy id is
// rewritten; every other value passes through untouched, so a future user group
// id is never clobbered.
export function migrateGroupId(id: string): string {
	return id === LEGACY_DEVOTIONAL_ID ? DEVOTIONAL_NONFICTION_ID : id;
}

// All mechanical rules a group's packs contribute, unfiltered by membership. The
// settings list renders these as toggles, so it needs the full set, including the
// checks a group turns off.
export function groupPackRules(group: GroupDefinition): Rule[] {
	const rules: Rule[] = [];
	for (const packId of group.extends) {
		for (const rule of PACK_MECHANICAL[packId] ?? []) {
			rules.push(rule);
		}
	}
	return rules;
}

// The protected-span kinds a group masks: the always-on base kinds plus any a
// pack adds (quoted verse for scripture).
export function groupSpanKinds(group: GroupDefinition): string[] {
	const kinds: string[] = [...BASE_SPAN_KINDS];
	for (const packId of group.extends) {
		for (const kind of PACK_EXTRA_SPAN_KINDS[packId] ?? []) {
			if (!kinds.includes(kind)) {
				kinds.push(kind);
			}
		}
	}
	return kinds;
}

function clampConfidence(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function clampThreshold(value: number): number {
	if (!Number.isFinite(value) || value < 1) {
		return DEFAULT_ROLLUP_THRESHOLD;
	}
	return Math.floor(value);
}

// Resolve a group definition into the per-document ResolvedConfig the engine
// consumes. Mechanical rules come from the extended packs, filtered and retuned by
// the membership map. Heuristics apply to every group; a membership can disable
// one (it lands in disabledSlugs, which the heuristic pass consults) or retune its
// confidence. A group with an empty membership map resolves to the packs at their
// defaults.
export function resolveGroup(group: GroupDefinition): ResolvedConfig {
	const protectedSpanKinds = groupSpanKinds(group);
	const mechanical = groupPackRules(group);

	const disabledSlugs: string[] = [];
	const confidenceBySlug: Record<string, number> = {};

	// Heuristics first: on for every group unless a membership disables them. A
	// disabled check does not run, so its confidence override is not recorded,
	// matching the mechanical branch below.
	for (const slug of HEURISTIC_SLUGS) {
		const membership = group.checks[slug];
		if (membership?.enabled === false) {
			disabledSlugs.push(slug);
			continue;
		}
		if (typeof membership?.confidence === 'number') {
			confidenceBySlug[slug] = clampConfidence(membership.confidence);
		}
	}

	const rules: Rule[] = [];
	for (const rule of mechanical) {
		const membership = group.checks[rule.slug];
		if (membership?.enabled === false) {
			disabledSlugs.push(rule.slug);
			continue;
		}
		if (typeof membership?.confidence === 'number') {
			confidenceBySlug[rule.slug] = clampConfidence(
				membership.confidence,
			);
		}
		// A severity override produces a copy so the shared pack record is never
		// mutated; every other case keeps the original reference.
		rules.push(
			membership?.severity
				? { ...rule, severity: membership.severity }
				: rule,
		);
	}

	return {
		profileId: group.id,
		protectedSpanKinds,
		rules,
		disabledSlugs,
		rollupThreshold: clampThreshold(group.rollupThreshold),
		confidenceBySlug,
	};
}
