import { shortHash } from './engine/finding-key';

// The vault-level index of written reports.
//
// A headless collaborator on the filesystem, the case the whole `.plumbline/`
// report exists for, should be able to find every report by reading one file
// rather than walking the vault and guessing which JSON belongs to which note.
// This is that file.

export const REPORT_DIR = '.plumbline';
export const REPORT_INDEX_PATH = `${REPORT_DIR}/index.json`;

// Bumped with the report schema, because a consumer reading the index to find
// reports has to know which report shape it is about to open.
//
//   3  reports carry a stable key per finding and per occurrence; this index
//      exists; report filenames are disambiguated by a path hash.
export const REPORT_INDEX_SCHEMA_VERSION = 3;

export interface ReportIndexEntry {
	// The note, as a vault-relative path.
	file: string;
	// The report, as a vault-relative path.
	report: string;
	profile: string;
	findings: number;
	// ISO 8601, when this note's report was last written.
	updated: string;
}

export interface ReportIndex {
	schemaVersion: number;
	reports: ReportIndexEntry[];
}

// Where a note's report is written.
//
// The flattened path alone collides: `a/b.md` and `a-b.md` both produce
// `a-b.md`, so one note's report would silently overwrite the other's, and the
// index would name one file for two notes. The hash of the FULL path
// disambiguates them while the readable part stays readable.
export function reportPathFor(notePath: string): string {
	const flat = notePath.split('/').join('-');
	return `${REPORT_DIR}/${flat}-${shortHash(notePath)}.json`;
}

export function emptyIndex(): ReportIndex {
	return { schemaVersion: REPORT_INDEX_SCHEMA_VERSION, reports: [] };
}

function isEntry(value: unknown): value is ReportIndexEntry {
	if (typeof value !== 'object' || value === null) return false;
	const record: Record<string, unknown> = { ...value };
	return (
		typeof record.file === 'string' &&
		typeof record.report === 'string' &&
		typeof record.profile === 'string' &&
		typeof record.findings === 'number' &&
		typeof record.updated === 'string'
	);
}

// Tolerant on purpose. The file sits in the user's vault, so it can be
// hand-edited, half-written, or synced mid-flight. A malformed index must cost
// the stale entries, never the write that is happening now, so anything
// unreadable is treated as empty and anything unreadable INSIDE a readable index
// is dropped entry by entry.
export function parseIndex(raw: unknown): ReportIndex {
	if (typeof raw !== 'object' || raw === null) return emptyIndex();
	const record: Record<string, unknown> = { ...raw };
	const reports = Array.isArray(record.reports)
		? record.reports.filter(isEntry)
		: [];
	return {
		schemaVersion:
			typeof record.schemaVersion === 'number'
				? record.schemaVersion
				: REPORT_INDEX_SCHEMA_VERSION,
		reports,
	};
}

// Replace this note's entry, or add it. Sorted by note path so the file has a
// stable order: an index that reshuffles on every write is a diff nobody can
// read, and these live in a vault people put under version control.
export function upsertEntry(
	index: ReportIndex,
	entry: ReportIndexEntry,
): ReportIndex {
	const reports = index.reports.filter((e) => e.file !== entry.file);
	reports.push(entry);
	reports.sort((a, b) => a.file.localeCompare(b.file));
	// Stamped with the CURRENT version rather than whatever was read. The file
	// now describes reports written by this build, and leaving an older number
	// on it would tell a consumer to expect the older shape.
	return { schemaVersion: REPORT_INDEX_SCHEMA_VERSION, reports };
}
