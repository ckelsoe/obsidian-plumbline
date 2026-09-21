import { Rule, Severity } from './types';
import { asSeverity, asStringArray } from './vault-config';
import { BASE_RULES } from './packs';
import { SCRIPTURE_RULES } from './scripture';
import { HEURISTIC_RULES } from './heuristics';

// Custom checks are the user's own library entries: phrase checks they create,
// or editable forks of a built-in. They live in the vault (.plumbline/checks.json),
// separate from the built-in packs (code) and from the flat vault config's global
// `rules` (config.json). A group turns a custom check on per membership, and unlike
// a pack check it defaults OFF, so a new check does nothing until a group enables
// it. See config-model.md, "Built-in checks versus custom checks".

export const USER_CHECKS_PATH = '.plumbline/checks.json';

// The origin tag a custom check carries, so the library can group it with the
// built-in packs under one axis. It is not a real pack: nothing in code extends
// it, and a group never lists it in `extends`.
export const CUSTOM_PACK_ID = 'custom';

// A library check the user authored. It is the rule record from config-model.md
// section 3 plus an editable display `name`, because a stable slug prettifies into
// a poor label ("custom-check-2") and the user should be able to call it what they
// mean. The slug stays stable once created; group memberships key on it.
export interface CustomCheck {
	slug: string;
	name: string;
	message: string;
	// The A-H detection category is a built-in concept; a user check is tagged
	// `custom` so the library's origin filter can gather them.
	category: string;
	severity: Severity;
	phrases: string[];
	// How often the check is right when it fires, 0..1. Omitted means the
	// mechanical default (0.9); the resolver clamps it.
	confidence?: number;
}

// The slugs the built-in packs and heuristics own. A custom check may never take
// one of these, or it would appear twice in a resolved group (once from the pack,
// once from the store) and its edits would fight the locked built-in.
const BUILTIN_SLUGS: ReadonlySet<string> = new Set([
	...BASE_RULES.map((rule) => rule.slug),
	...SCRIPTURE_RULES.map((rule) => rule.slug),
	...HEURISTIC_RULES.map((rule) => rule.slug),
]);

export function isBuiltInSlug(slug: string): boolean {
	return BUILTIN_SLUGS.has(slug);
}

// Convert a custom check into the engine's Rule shape. The engine never sees the
// display `name`; it reads slug, severity, message, and phrases like any rule.
export function customCheckToRule(check: CustomCheck): Rule {
	return {
		slug: check.slug,
		packId: CUSTOM_PACK_ID,
		category: check.category,
		severity: check.severity,
		message: check.message,
		phrases: [...check.phrases],
		...(check.confidence !== undefined
			? { confidence: check.confidence }
			: {}),
	};
}

// One custom check parsed from disk, or null when it has no usable id, name, or
// message, or when its slug collides with a built-in. Every field is validated so
// a hand-edited file cannot smuggle a bad severity or non-string phrase into the
// resolver.
function asCustomCheck(raw: unknown): CustomCheck | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.slug !== 'string' || obj.slug.length === 0) {
		return null;
	}
	if (isBuiltInSlug(obj.slug)) {
		return null;
	}
	if (typeof obj.name !== 'string' || obj.name.length === 0) {
		return null;
	}
	if (typeof obj.message !== 'string' || obj.message.length === 0) {
		return null;
	}
	const severity = asSeverity(obj.severity) ?? 'suggestion';
	const check: CustomCheck = {
		slug: obj.slug,
		name: obj.name,
		message: obj.message,
		category:
			typeof obj.category === 'string' && obj.category.length > 0
				? obj.category
				: CUSTOM_PACK_ID,
		severity,
		// Empty phrases are dropped: an empty string builds a zero-width matcher
		// (`\b(?:)\b`) that matches at every word boundary, which with the global
		// flag loops forever in applyRules. A hand-edited file is the only way one
		// arrives (the UI's phrase split already drops blank lines).
		phrases: asStringArray(obj.phrases).filter(
			(phrase) => phrase.length > 0,
		),
	};
	// Confidence is range-clamped by the resolver, so it only needs to be a finite
	// number here to be worth carrying.
	if (typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)) {
		check.confidence = obj.confidence;
	}
	return check;
}

// Parse the checks file into a list. Anything malformed is dropped rather than
// thrown, and two checks sharing a slug keep the first, matching parseUserGroups.
export function parseUserChecks(raw: unknown): CustomCheck[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const checks: CustomCheck[] = [];
	for (const entry of raw) {
		const check = asCustomCheck(entry);
		if (check === null) {
			continue;
		}
		if (seen.has(check.slug)) {
			continue;
		}
		seen.add(check.slug);
		checks.push(check);
	}
	return checks;
}

// Serialize the custom checks for the vault file. `confidence` is written only
// when set, so a check on the default stays sparse.
export function serializeUserChecks(checks: readonly CustomCheck[]): string {
	const shape = checks.map((check) => ({
		slug: check.slug,
		name: check.name,
		message: check.message,
		category: check.category,
		severity: check.severity,
		phrases: check.phrases,
		...(check.confidence !== undefined
			? { confidence: check.confidence }
			: {}),
	}));
	return JSON.stringify(shape, null, 2);
}

// A custom check by slug, or undefined.
export function findCustomCheck(
	slug: string,
	checks: readonly CustomCheck[],
): CustomCheck | undefined {
	return checks.find((check) => check.slug === slug);
}
