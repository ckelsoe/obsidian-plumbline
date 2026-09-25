import { asStringArray } from './vault-config';

// References are named files or folders in the vault that a reference-driven
// check reads: Bible text or other source notes for the quote checks, a voice
// file (term list), or a folder of character notes (name list). They are defined
// once and each group picks the ones it uses. See config-model.md, "References:
// files and folders a group checks against".
//
// Which groups use which references is stored here, beside the references, not
// on the group definitions. A starter group is read-only code, but the files it
// checks against are this vault's data, so a starter can use a reference without
// being forked into a copy.
export const REFERENCES_PATH = '.plumbline/references.json';

// Only types whose feature has shipped are listed, so the UI never offers a type
// that does nothing.
//
// 'quote-source' is the scripture layout (translation, book and chapter
// folders); 'source-notes' is any folder of notes, for quotes that cite one
// note with a wikilink. 'name-list' is a folder of notes about people and
// places, whose titles and aliases are the names to check spelling against.
export type ReferenceType =
	'quote-source' | 'source-notes' | 'term-list' | 'name-list';

export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
	'quote-source': 'Quote source (scripture layout)',
	'source-notes': 'Quote source (any notes)',
	'term-list': 'Term list (voice or style file)',
	'name-list': 'Name list (people and places)',
};

// Whether a type points at a folder or at a single note.
export function referenceTargetsFile(type: ReferenceType): boolean {
	return type === 'term-list';
}

export interface Reference {
	id: string;
	name: string;
	type: ReferenceType;
	// Vault-relative path of the folder (or, for a file type, the file).
	path: string;
}

export interface ReferenceStore {
	references: Reference[];
	// Group id to the ids of the references it uses, in the order chosen.
	assignments: Record<string, string[]>;
}

export function emptyReferenceStore(): ReferenceStore {
	return { references: [], assignments: {} };
}

function isReferenceType(value: unknown): value is ReferenceType {
	return typeof value === 'string' && value in REFERENCE_TYPE_LABELS;
}

// One reference parsed from disk, or null when a field is missing or the type is
// unknown. The path may be empty: a reference is saved as soon as it is created,
// before a path is chosen, and is simply invalid until one is.
function asReference(raw: unknown): Reference | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== 'string' || obj.id.length === 0) {
		return null;
	}
	if (typeof obj.name !== 'string' || !isReferenceType(obj.type)) {
		return null;
	}
	return {
		id: obj.id,
		name: obj.name,
		type: obj.type,
		path: typeof obj.path === 'string' ? obj.path : '',
	};
}

// Parse the references file. Malformed entries are dropped rather than failing
// the load, a duplicate id keeps the first, and an assignment keeps only ids that
// name a real reference, each once.
export function parseReferenceStore(raw: unknown): ReferenceStore {
	if (typeof raw !== 'object' || raw === null) {
		return emptyReferenceStore();
	}
	const obj = raw as Record<string, unknown>;
	const references: Reference[] = [];
	const ids = new Set<string>();
	for (const entry of Array.isArray(obj.references) ? obj.references : []) {
		const reference = asReference(entry);
		if (reference && !ids.has(reference.id)) {
			ids.add(reference.id);
			references.push(reference);
		}
	}
	const assignments: Record<string, string[]> = {};
	if (typeof obj.assignments === 'object' && obj.assignments !== null) {
		for (const [groupId, value] of Object.entries(
			obj.assignments as Record<string, unknown>,
		)) {
			const kept = [
				...new Set(asStringArray(value).filter((id) => ids.has(id))),
			];
			if (kept.length > 0) {
				assignments[groupId] = kept;
			}
		}
	}
	return { references, assignments };
}

export function serializeReferenceStore(store: ReferenceStore): string {
	return JSON.stringify(store, null, 2);
}

// The references a group uses, in the order chosen, skipping any stale id.
export function referencesForGroup(
	store: ReferenceStore,
	groupId: string,
): Reference[] {
	const byId = new Map(store.references.map((r) => [r.id, r]));
	return (store.assignments[groupId] ?? [])
		.map((id) => byId.get(id))
		.filter((r): r is Reference => r !== undefined);
}

export function isAssigned(
	store: ReferenceStore,
	groupId: string,
	referenceId: string,
): boolean {
	return store.assignments[groupId]?.includes(referenceId) ?? false;
}

// Turn one reference on or off for a group. An emptied assignment is removed so
// the file stays sparse.
export function setAssigned(
	store: ReferenceStore,
	groupId: string,
	referenceId: string,
	on: boolean,
): void {
	const current = store.assignments[groupId] ?? [];
	const next = on
		? current.includes(referenceId)
			? current
			: [...current, referenceId]
		: current.filter((id) => id !== referenceId);
	if (next.length > 0) {
		store.assignments[groupId] = next;
	} else {
		delete store.assignments[groupId];
	}
}

// Remove a reference and every group's use of it.
export function removeReference(store: ReferenceStore, id: string): void {
	store.references = store.references.filter((r) => r.id !== id);
	for (const groupId of Object.keys(store.assignments)) {
		setAssigned(store, groupId, id, false);
	}
}

// Follow a vault rename or move. A reference whose path is the renamed item, or
// lies inside a renamed folder, is rewritten to the new location. Returns true
// when anything changed, so the caller knows to save.
export function followRename(
	store: ReferenceStore,
	oldPath: string,
	newPath: string,
): boolean {
	let changed = false;
	for (const reference of store.references) {
		if (reference.path === oldPath) {
			reference.path = newPath;
			changed = true;
		} else if (reference.path.startsWith(`${oldPath}/`)) {
			reference.path = newPath + reference.path.slice(oldPath.length);
			changed = true;
		}
	}
	return changed;
}

// A reference id not already taken, derived from a name ("Bible text" ->
// "bible-text", then "bible-text-2", ...).
export function uniqueReferenceId(
	name: string,
	taken: ReadonlySet<string>,
): string {
	// Built with a character loop rather than chained regexes: runs of anything
	// else collapse to one dash, and no dash is left at either end.
	let slug = '';
	for (const char of name.toLowerCase()) {
		const keep =
			(char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
		if (keep) {
			slug += char;
		} else if (slug.length > 0 && !slug.endsWith('-')) {
			slug += '-';
		}
	}
	if (slug.endsWith('-')) {
		slug = slug.slice(0, -1);
	}
	const base = slug || 'reference';
	if (!taken.has(base)) {
		return base;
	}
	let n = 2;
	while (taken.has(`${base}-${n}`)) {
		n += 1;
	}
	return `${base}-${n}`;
}
