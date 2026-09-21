import {
	CheckMembership,
	GroupDefinition,
	STARTER_GROUPS,
	starterGroup,
} from './groups';
import { DEFAULT_ROLLUP_THRESHOLD } from './rollup';
import { asSeverity, asStringArray } from './vault-config';

// User groups live in the vault (.plumbline/groups.json), editable and shareable;
// the built-in starters ship read-only in code. This module parses that untrusted
// file defensively and resolves a group id across both sets. Custom checks and
// the library picker are a later slice; this one is the group store and the
// multi-group resolver. See config-model.md, "What lives where".

export const USER_GROUPS_PATH = '.plumbline/groups.json';

// One check's membership in a group, parsed from disk. Every field is optional and
// a value is kept only when it is the right type, so a hand-edited file cannot
// smuggle a bad severity or a non-numeric threshold into the resolver.
function asMembership(raw: unknown): CheckMembership {
	const membership: CheckMembership = {};
	if (typeof raw !== 'object' || raw === null) {
		return membership;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.enabled === 'boolean') {
		membership.enabled = obj.enabled;
	}
	const severity = asSeverity(obj.severity);
	if (severity) {
		membership.severity = severity;
	}
	// Confidence and roll-up are range-clamped by the resolver (resolveGroup), so
	// here they only need to be finite numbers to be worth carrying.
	if (typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)) {
		membership.confidence = obj.confidence;
	}
	if (typeof obj.rollup === 'number' && Number.isFinite(obj.rollup)) {
		membership.rollup = obj.rollup;
	}
	return membership;
}

function asChecks(raw: unknown): Record<string, CheckMembership> {
	const checks: Record<string, CheckMembership> = {};
	if (typeof raw !== 'object' || raw === null) {
		return checks;
	}
	for (const [slug, value] of Object.entries(
		raw as Record<string, unknown>,
	)) {
		checks[slug] = asMembership(value);
	}
	return checks;
}

// One group definition, or null when it has no usable id or name. builtIn is
// forced false whatever the file says: a group loaded from the vault is always
// editable, and only the in-code starters are read-only.
function asGroup(raw: unknown): GroupDefinition | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== 'string' || obj.id.length === 0) {
		return null;
	}
	if (typeof obj.name !== 'string' || obj.name.length === 0) {
		return null;
	}
	const rollupThreshold =
		typeof obj.rollupThreshold === 'number' &&
		Number.isFinite(obj.rollupThreshold)
			? obj.rollupThreshold
			: DEFAULT_ROLLUP_THRESHOLD;
	return {
		id: obj.id,
		name: obj.name,
		builtIn: false,
		extends: asStringArray(obj.extends),
		rollupThreshold,
		checks: asChecks(obj.checks),
	};
}

// Parse the user-groups file into a list of editable groups. Anything malformed is
// dropped rather than throwing. A user group whose id collides with a built-in
// starter (including the legacy scripture-book alias) is dropped, so a starter is
// always the read-only one and a vault file can never shadow it.
export function parseUserGroups(raw: unknown): GroupDefinition[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const groups: GroupDefinition[] = [];
	for (const entry of raw) {
		const group = asGroup(entry);
		if (group === null) {
			continue;
		}
		// starterGroup resolves real starter ids and the legacy alias, so this
		// also blocks a file that tries to redefine scripture-book.
		if (starterGroup(group.id) !== undefined) {
			continue;
		}
		// A file with two groups sharing an id keeps the first; the resolver looks
		// up by id and a duplicate would otherwise be unreachable but still listed.
		if (seen.has(group.id)) {
			continue;
		}
		seen.add(group.id);
		groups.push(group);
	}
	return groups;
}

// Serialize user groups for the vault file. builtIn is not written: the file only
// ever holds user groups, and the flag is derived (false) on read.
export function serializeUserGroups(
	groups: readonly GroupDefinition[],
): string {
	const shape = groups.map((g) => ({
		id: g.id,
		name: g.name,
		extends: g.extends,
		rollupThreshold: g.rollupThreshold,
		checks: g.checks,
	}));
	return JSON.stringify(shape, null, 2);
}

// A group by id, across the built-in starters (and the legacy alias) and the
// user groups. Undefined when nothing matches; callers decide the fallback.
export function findGroup(
	id: string,
	userGroups: readonly GroupDefinition[],
): GroupDefinition | undefined {
	return starterGroup(id) ?? userGroups.find((g) => g.id === id);
}

// Every group the user can pick: the read-only starters first, then their own.
export function allGroups(
	userGroups: readonly GroupDefinition[],
): GroupDefinition[] {
	return [...STARTER_GROUPS, ...userGroups];
}
