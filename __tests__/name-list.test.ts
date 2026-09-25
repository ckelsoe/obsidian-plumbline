import {
	buildNameIndex,
	checkNames,
	describeNameList,
	editDistance,
	NAME_SLUG,
} from '../engine/name-list';
import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';

const cast = buildNameIndex([
	{
		reference: 'Cast',
		names: ['Catherine', 'Jonathan', 'Jon', 'Mary Jane', 'Eldoria'],
	},
]);

function flagged(text: string, index = cast): string[] {
	return checkNames(text, index).map((d) => text.slice(d.start, d.end));
}

describe('editDistance', () => {
	it('counts substitutions, insertions, deletions and swaps as one edit', () => {
		expect(editDistance('katherine', 'catherine', 2)).toBe(1);
		expect(editDistance('jonathon', 'jonathan', 2)).toBe(1);
		expect(editDistance('eldora', 'eldoria', 2)).toBe(1);
		expect(editDistance('jonahtan', 'jonathan', 2)).toBe(1);
		expect(editDistance('same', 'same', 1)).toBe(0);
	});

	it('reports anything past the limit as limit + 1', () => {
		expect(editDistance('abcd', 'wxyz', 1)).toBe(2);
		expect(editDistance('ab', 'abcdef', 2)).toBe(3);
	});
});

describe('checkNames', () => {
	it('flags a near miss and offers the canonical name, labelled', () => {
		const text = 'Katherine walked in.';
		const [diag] = checkNames(text, cast);
		expect(diag?.ruleSlug).toBe(NAME_SLUG);
		expect(text.slice(diag?.start, diag?.end)).toBe('Katherine');
		expect(diag?.message).toBe('Cast: did you mean "Catherine"?');
		expect(diag?.fixOptions).toEqual([
			{ text: 'Catherine', source: 'Cast' },
		]);
	});

	it('never flags an exact name or alias, in any case', () => {
		expect(flagged('Catherine met Jon and JONATHAN.')).toEqual([]);
	});

	it('does not flag a family named in the plural, or a word in capitals', () => {
		const families = buildNameIndex([
			{ reference: 'Cast', names: ['Bennet', 'Jones', 'Catherine'] },
		]);
		expect(flagged('The Bennets and the Joneses came.', families)).toEqual(
			[],
		);
		expect(flagged('KATHERINE', families)).toEqual([]);
		expect(flagged('Katherine', families)).toEqual(['Katherine']);
	});

	it('allows two edits only for names of eight or more letters', () => {
		// Jonathan has 8 letters: two edits away is still flagged.
		expect(flagged('Jonahtin arrived.')).toEqual(['Jonahtin']);
		// Eldoria has 7: one edit is flagged, two is not.
		expect(flagged('They reached Eldora.')).toEqual(['Eldora']);
		expect(flagged('They reached Eldra.')).toEqual([]);
	});

	it('counts only letters toward the long-name threshold', () => {
		// D'Angelo has seven letters, so only one edit is allowed.
		const apostrophe = buildNameIndex([
			{ reference: 'Cast', names: ["D'Angelo"] },
		]);
		expect(flagged("D'Angela came.", apostrophe)).toEqual(["D'Angela"]);
		expect(flagged("D'Ankela came.", apostrophe)).toEqual([]);
	});

	it('only checks capitalised words of four or more letters', () => {
		expect(flagged('katherine walked in.')).toEqual([]);
		// "Joan" is one edit from "Jon", but Jon has three letters.
		expect(flagged('Joan waved.')).toEqual([]);
	});

	it('matches a multi-word name as a run of capitalised words', () => {
		expect(flagged('Then Mary Jayne left.')).toEqual(['Mary Jayne']);
		expect(flagged('Then Mary Jane left.')).toEqual([]);
		expect(flagged('Then Mary. Jayne left.')).toEqual([]);
	});

	it('compares the name in a possessive, and keeps inner apostrophes', () => {
		expect(flagged("Katherine's hat.")).toEqual(['Katherine']);
		const irish = buildNameIndex([
			{ reference: 'Cast', names: ["O'Brien"] },
		]);
		expect(flagged("O'Brian nodded.", irish)).toEqual(["O'Brian"]);
	});

	it('reads curly and straight apostrophes as the same letter', () => {
		const straight = buildNameIndex([
			{ reference: 'Cast', names: ["O'Brien"] },
		]);
		const curly = buildNameIndex([
			{ reference: 'Cast', names: ['O’Brien'] },
		]);
		expect(flagged('O’Brien nodded.', straight)).toEqual([]);
		expect(flagged("O'Brien nodded.", curly)).toEqual([]);
		// A real near miss is still one edit, and the fix keeps the list's form.
		const [diag] = checkNames('O’Brian nodded.', straight);
		expect(diag?.fixOptions).toEqual([{ text: "O'Brien", source: 'Cast' }]);
	});

	it('offers every name a word is near, each with its list', () => {
		const two = buildNameIndex([
			{ reference: 'Cast', names: ['Joann'] },
			{ reference: 'Places', names: ['Jeann'] },
		]);
		const [diag] = checkNames('Joann and Jaann.', two).filter(
			(d) => d.start > 0,
		);
		expect(diag?.fixOptions).toEqual([
			{ text: 'Joann', source: 'Cast' },
			{ text: 'Jeann', source: 'Places' },
		]);
		expect(diag?.message).toBe(
			'Close to "Joann" (Cast) and "Jeann" (Places). Pick one, or leave it.',
		);
	});

	it('names both lists once when a name is in two of them', () => {
		const both = buildNameIndex([
			{ reference: 'Cast', names: ['Catherine'] },
			{ reference: 'Family tree', names: ['catherine'] },
		]);
		const [diag] = checkNames('Katherine.', both);
		expect(diag?.fixOptions).toEqual([
			{ text: 'Catherine', source: 'Cast, Family tree' },
		]);
	});
});

describe('describeNameList', () => {
	it('summarises names and aliases', () => {
		expect(describeNameList(1, 0)).toBe('1 name.');
		expect(describeNameList(12, 3)).toBe('12 names (3 aliases).');
		expect(describeNameList(2, 1)).toBe('2 names (1 alias).');
	});
});

describe('lint with name lists', () => {
	const base = resolveConfig('default');
	const has = (text: string, config: typeof base): boolean =>
		lint(text, config).diagnostics.some((d) => d.ruleSlug === NAME_SLUG);

	it('checks names only when the group has a name list', () => {
		expect(has('Katherine walked in.', base)).toBe(false);
		expect(has('Katherine walked in.', { ...base, names: cast })).toBe(
			true,
		);
	});

	it('skips names in code and in notes that turn the check off', () => {
		const config = { ...base, names: cast };
		expect(has('`Katherine`', config)).toBe(false);
		const note = (slug: string): string =>
			`---\nplumbline-disabled-rules: [${slug}]\n---\nKatherine walked in.`;
		expect(has(note('some-other-rule'), config)).toBe(true);
		expect(has(note(NAME_SLUG), config)).toBe(false);
	});
});
