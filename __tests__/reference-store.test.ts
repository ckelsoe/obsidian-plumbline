import {
	emptyReferenceStore,
	followRename,
	isAssigned,
	parseReferenceStore,
	referencesForGroup,
	ReferenceStore,
	removeReference,
	serializeReferenceStore,
	setAssigned,
	uniqueReferenceId,
} from '../engine/reference-store';

function store(): ReferenceStore {
	return {
		references: [
			{
				id: 'bible',
				name: 'Bible text',
				type: 'quote-source',
				path: 'Bible',
			},
			{
				id: 'hymns',
				name: 'Hymns',
				type: 'quote-source',
				path: 'Lib/Hymns',
			},
		],
		assignments: { devotional: ['bible', 'hymns'] },
	};
}

describe('parseReferenceStore', () => {
	it('round-trips a serialized store', () => {
		const original = store();
		expect(
			parseReferenceStore(JSON.parse(serializeReferenceStore(original))),
		).toEqual(original);
	});

	it('returns an empty store for anything that is not an object', () => {
		expect(parseReferenceStore(null)).toEqual(emptyReferenceStore());
		expect(parseReferenceStore('x')).toEqual(emptyReferenceStore());
	});

	it('drops malformed references, unknown types, and duplicate ids', () => {
		const parsed = parseReferenceStore({
			references: [
				{ id: 'a', name: 'A', type: 'quote-source', path: 'A' },
				{ id: 'a', name: 'Dup', type: 'quote-source', path: 'B' },
				{ id: 'b', name: 'B', type: 'not-a-type', path: 'B' },
				{ name: 'No id', type: 'quote-source' },
				{ id: 'c', name: 'C', type: 'quote-source' },
			],
		});
		expect(parsed.references.map((r) => [r.id, r.name, r.path])).toEqual([
			['a', 'A', 'A'],
			['c', 'C', ''],
		]);
	});

	it('keeps only assignments to real references, each once', () => {
		const parsed = parseReferenceStore({
			references: [
				{ id: 'a', name: 'A', type: 'quote-source', path: 'A' },
			],
			assignments: { g1: ['a', 'ghost', 'a'], g2: ['ghost'], g3: 'a' },
		});
		expect(parsed.assignments).toEqual({ g1: ['a'] });
	});
});

describe('assignments', () => {
	it('lists a group’s references in the chosen order', () => {
		expect(
			referencesForGroup(store(), 'devotional').map((r) => r.id),
		).toEqual(['bible', 'hymns']);
		expect(referencesForGroup(store(), 'other')).toEqual([]);
	});

	it('turns a reference on once and off again, removing an emptied group', () => {
		const s = store();
		setAssigned(s, 'plain', 'bible', true);
		setAssigned(s, 'plain', 'bible', true);
		expect(s.assignments.plain).toEqual(['bible']);
		expect(isAssigned(s, 'plain', 'bible')).toBe(true);
		setAssigned(s, 'plain', 'bible', false);
		expect('plain' in s.assignments).toBe(false);
	});

	it('removing a reference removes every group’s use of it', () => {
		const s = store();
		setAssigned(s, 'plain', 'bible', true);
		removeReference(s, 'bible');
		expect(s.references.map((r) => r.id)).toEqual(['hymns']);
		expect(s.assignments).toEqual({ devotional: ['hymns'] });
	});
});

describe('followRename', () => {
	it('rewrites a reference whose folder was renamed', () => {
		const s = store();
		expect(followRename(s, 'Bible', 'Scripture')).toBe(true);
		expect(s.references[0]?.path).toBe('Scripture');
	});

	it('rewrites a reference inside a renamed parent folder', () => {
		const s = store();
		expect(followRename(s, 'Lib', 'Library')).toBe(true);
		expect(s.references[1]?.path).toBe('Library/Hymns');
	});

	it('leaves a sibling with a shared name prefix alone', () => {
		const s = store();
		expect(followRename(s, 'Bib', 'X')).toBe(false);
		expect(s.references[0]?.path).toBe('Bible');
	});
});

describe('uniqueReferenceId', () => {
	it('slugs the name and avoids taken ids', () => {
		expect(uniqueReferenceId('Bible text', new Set())).toBe('bible-text');
		expect(uniqueReferenceId('Bible text', new Set(['bible-text']))).toBe(
			'bible-text-2',
		);
		expect(uniqueReferenceId('  KJV (1611)! ', new Set())).toBe('kjv-1611');
		expect(uniqueReferenceId('!!!', new Set())).toBe('reference');
	});
});
