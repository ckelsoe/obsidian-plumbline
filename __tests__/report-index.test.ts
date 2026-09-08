import {
	REPORT_INDEX_SCHEMA_VERSION,
	ReportIndexEntry,
	emptyIndex,
	parseIndex,
	reportPathFor,
	upsertEntry,
} from '../report-index';

const entry = (file: string, findings = 1): ReportIndexEntry => ({
	file,
	report: reportPathFor(file),
	profile: 'scripture-book',
	findings,
	updated: '2026-09-08T00:00:00.000Z',
});

describe('reportPathFor', () => {
	it('writes into the plumbline folder as JSON', () => {
		expect(reportPathFor('ch01.md')).toMatch(
			/^\.plumbline\/ch01\.md-[0-9a-f]{8}\.json$/,
		);
	});

	it('keeps the note path readable in the filename', () => {
		expect(reportPathFor('chapters/ch01.md')).toContain('chapters-ch01.md');
	});

	// The flattened path ALONE collides: both of these produce `a-b.md`, so one
	// note's report would silently overwrite the other's and the index would name
	// one file for two notes.
	it('does not collide between a folder and a hyphen', () => {
		expect(reportPathFor('a/b.md')).not.toBe(reportPathFor('a-b.md'));
	});

	it('is the same path every time for the same note', () => {
		expect(reportPathFor('a/b.md')).toBe(reportPathFor('a/b.md'));
	});
});

describe('upsertEntry', () => {
	it('adds a note that is not indexed yet', () => {
		const index = upsertEntry(emptyIndex(), entry('a.md'));
		expect(index.reports.map((r) => r.file)).toEqual(['a.md']);
	});

	// Re-running the report on one note must not add a second row for it.
	it('replaces the entry for a note already indexed', () => {
		let index = upsertEntry(emptyIndex(), entry('a.md', 3));
		index = upsertEntry(index, entry('a.md', 7));
		expect(index.reports).toHaveLength(1);
		expect(index.reports[0]?.findings).toBe(7);
	});

	it('leaves other notes alone', () => {
		let index = upsertEntry(emptyIndex(), entry('a.md', 3));
		index = upsertEntry(index, entry('b.md', 5));
		index = upsertEntry(index, entry('a.md', 9));
		expect(index.reports.map((r) => [r.file, r.findings])).toEqual([
			['a.md', 9],
			['b.md', 5],
		]);
	});

	// These live in a vault people put under version control. An index that
	// reshuffles on every write is a diff nobody can read.
	it('sorts by note path whatever order the writes arrive in', () => {
		let index = emptyIndex();
		for (const file of ['c.md', 'a.md', 'b.md']) {
			index = upsertEntry(index, entry(file));
		}
		expect(index.reports.map((r) => r.file)).toEqual([
			'a.md',
			'b.md',
			'c.md',
		]);
	});

	it('stamps the current schema version, not the one it read', () => {
		const stale = { schemaVersion: 1, reports: [] };
		expect(upsertEntry(stale, entry('a.md')).schemaVersion).toBe(
			REPORT_INDEX_SCHEMA_VERSION,
		);
	});

	it('does not mutate the index it was given', () => {
		const before = upsertEntry(emptyIndex(), entry('a.md'));
		upsertEntry(before, entry('b.md'));
		expect(before.reports.map((r) => r.file)).toEqual(['a.md']);
	});
});

// The file sits in the user's vault, so it can be hand-edited, half-written, or
// synced mid-flight. Losing the index must never cost the report being written.
describe('parseIndex', () => {
	it('reads back what upsertEntry wrote', () => {
		const written = upsertEntry(emptyIndex(), entry('a.md', 4));
		expect(parseIndex(JSON.parse(JSON.stringify(written)))).toEqual(
			written,
		);
	});

	it('treats anything that is not an index as empty', () => {
		for (const raw of [null, undefined, 42, 'nonsense', [], {}]) {
			expect(parseIndex(raw).reports).toEqual([]);
		}
	});

	it('defaults the version when the file does not carry one', () => {
		expect(parseIndex({ reports: [] }).schemaVersion).toBe(
			REPORT_INDEX_SCHEMA_VERSION,
		);
	});

	it('keeps a version it does not recognise, so a consumer can refuse it', () => {
		expect(
			parseIndex({ schemaVersion: 99, reports: [] }).schemaVersion,
		).toBe(99);
	});

	// One mangled row must not cost the rest of the index.
	it('drops only the entries it cannot read', () => {
		const good = entry('a.md');
		const index = parseIndex({
			schemaVersion: REPORT_INDEX_SCHEMA_VERSION,
			reports: [
				good,
				{ file: 'b.md' },
				null,
				'nonsense',
				{ ...entry('c.md'), findings: 'many' },
			],
		});
		expect(index.reports).toEqual([good]);
	});

	it('treats a non-array reports field as empty', () => {
		expect(
			parseIndex({ schemaVersion: 3, reports: 'nope' }).reports,
		).toEqual([]);
	});
});
