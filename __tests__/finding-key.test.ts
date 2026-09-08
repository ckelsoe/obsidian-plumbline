import {
	normalizeAnchor,
	occurrenceKey,
	withDiagnosticKeys,
	withKeys,
} from '../engine/finding-key';
import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';
import { Finding } from '../engine/types';

const config = resolveConfig('scripture-book');

const finding = (slug: string, ranges: [number, number][]): Finding => ({
	key: '',
	ruleSlug: slug,
	packId: 'base',
	severity: 'warning',
	message: `${slug} message`,
	occurrences: ranges.map(([start, end]) => ({ start, end, key: '' })),
	confidence: 0.9,
	priority: 9,
	rolledUp: false,
});

describe('normalizeAnchor', () => {
	// Rewrapping a paragraph or switching line endings must not orphan a comment
	// thread, so neither may change the key.
	it('ignores case, surrounding space, and how whitespace is spelled', () => {
		const forms = [
			'Read that again',
			'read that again',
			'  READ that  again  ',
			'Read\tthat\nagain',
			'Read that\r\nagain',
		];
		const normalized = forms.map(normalizeAnchor);
		expect(new Set(normalized).size).toBe(1);
		expect(normalized[0]).toBe('read that again');
	});

	// Punctuation is part of the prose. Changing it is an edit.
	it('keeps punctuation', () => {
		expect(normalizeAnchor('Read that again.')).not.toBe(
			normalizeAnchor('Read that again'),
		);
	});
});

describe('occurrenceKey', () => {
	it('is eight hex characters', () => {
		for (const text of ['a', '', 'a much longer anchor phrase here']) {
			expect(occurrenceKey('slug', text, 0)).toMatch(/^[0-9a-f]{8}$/);
		}
	});

	// A hash below 0x10000000 renders as seven hex digits and has to be padded,
	// or one key in sixteen is a different width from the rest and anything
	// slicing the `[source=plumbline:...]` token by length reads it wrong. The
	// cases above all happen to land above that line, so this one is picked to
	// fall under it.
	it('pads a hash that renders short', () => {
		expect(occurrenceKey('slug', 'w10', 0)).toBe('03de08c6');
	});

	it('is the same for the same inputs', () => {
		expect(occurrenceKey('anaphora', 'The Lord', 2)).toBe(
			occurrenceKey('anaphora', 'The Lord', 2),
		);
	});

	// The three fields that make up the identity. Each one has to move the key,
	// or two different findings would share one.
	it('changes with the rule, the text, and the index', () => {
		const base = occurrenceKey('anaphora', 'The Lord', 0);
		expect(occurrenceKey('emphasis-fragment', 'The Lord', 0)).not.toBe(
			base,
		);
		expect(occurrenceKey('anaphora', 'The Lord is', 0)).not.toBe(base);
		expect(occurrenceKey('anaphora', 'The Lord', 1)).not.toBe(base);
	});

	// The separator earns its place: without it, ('ab', 'c') and ('a', 'bc')
	// would hash the same string.
	it('does not let adjacent fields run together', () => {
		expect(occurrenceKey('ab', 'c', 0)).not.toBe(
			occurrenceKey('a', 'bc', 0),
		);
	});
});

describe('withKeys', () => {
	const TEXT = 'alpha     bravo     alpha     ';

	it('numbers the occurrences of a rule in document order', () => {
		const [f] = withKeys(TEXT, [
			finding('r', [
				[0, 5],
				[20, 25],
			]),
		]);
		// Same anchor text at both places, so only the index separates them.
		expect(TEXT.slice(0, 5)).toBe(TEXT.slice(20, 25));
		expect(f?.occurrences[0]?.key).not.toBe(f?.occurrences[1]?.key);
		expect(f?.occurrences[0]?.key).toBe(occurrenceKey('r', 'alpha', 0));
		expect(f?.occurrences[1]?.key).toBe(occurrenceKey('r', 'alpha', 1));
	});

	// The index is assigned by position, not by the order the caller happened to
	// collect the hits in, or two runs over one note could disagree.
	it('numbers by position even when the input is out of order', () => {
		const ordered = withKeys(TEXT, [
			finding('r', [
				[0, 5],
				[20, 25],
			]),
		]);
		const reversed = withKeys(TEXT, [
			finding('r', [
				[20, 25],
				[0, 5],
			]),
		]);
		expect(reversed[0]?.occurrences[0]?.key).toBe(
			ordered[0]?.occurrences[1]?.key,
		);
		expect(reversed[0]?.occurrences[1]?.key).toBe(
			ordered[0]?.occurrences[0]?.key,
		);
	});

	it('takes the finding key from the first occurrence', () => {
		const [f] = withKeys(TEXT, [
			finding('r', [
				[0, 5],
				[20, 25],
			]),
		]);
		expect(f?.key).toBe(f?.occurrences[0]?.key);
	});

	// The whole reason the index is counted per anchor text. Numbering across all
	// of a rule's hits meant deleting one renumbered every later one, so fixing
	// the first of twelve flagged phrases changed the key of the other eleven and
	// a consumer would have seen eleven new findings where it already had
	// threads.
	it('keeps a key when a different earlier occurrence of the same rule goes away', () => {
		const withBoth = withKeys(TEXT, [
			finding('r', [
				[0, 5],
				[10, 15],
			]),
		]);
		// 'bravo' alone, the earlier 'alpha' having been fixed.
		const withoutFirst = withKeys(TEXT, [finding('r', [[10, 15]])]);
		expect(TEXT.slice(0, 5)).not.toBe(TEXT.slice(10, 15));
		expect(withoutFirst[0]?.occurrences[0]?.key).toBe(
			withBoth[0]?.occurrences[1]?.key,
		);
	});

	// The limit of that, stated rather than left to be discovered. Two hits with
	// the SAME text are indistinguishable, so removing the first does renumber
	// the second. No scheme built on the text can do better, and the alternative
	// (numbering by position) renumbers on far more edits.
	it('does renumber when an identical earlier occurrence goes away', () => {
		const withBoth = withKeys(TEXT, [
			finding('r', [
				[0, 5],
				[20, 25],
			]),
		]);
		const withoutFirst = withKeys(TEXT, [finding('r', [[20, 25]])]);
		expect(TEXT.slice(0, 5)).toBe(TEXT.slice(20, 25));
		expect(withoutFirst[0]?.occurrences[0]?.key).not.toBe(
			withBoth[0]?.occurrences[1]?.key,
		);
	});

	// The counter is keyed on the NORMALIZED anchor, because that is what the key
	// hashes. Counting raw text instead gives both of these index 0, and since
	// they normalize to the same string they then hash to the same key: two
	// distinct occurrences sharing one identity, so promoting both creates one
	// comment.
	it('separates occurrences that differ only in case or spacing', () => {
		const CASES = 'Alpha     alpha     ALPHA     ';
		const [f] = withKeys(CASES, [
			finding('r', [
				[0, 5],
				[10, 15],
				[20, 25],
			]),
		]);
		const keys = f?.occurrences.map((o) => o.key) ?? [];
		expect(new Set(keys).size).toBe(3);
	});

	it('leaves the ranges alone', () => {
		const [f] = withKeys(TEXT, [finding('r', [[0, 5]])]);
		expect(f?.occurrences[0]?.start).toBe(0);
		expect(f?.occurrences[0]?.end).toBe(5);
	});
});

// Contract 7.2 in the terms that matter: a re-lint of unchanged prose has to
// produce the same keys, and editing the flagged phrase has to produce
// different ones. This drives lint() because that is the path both the report
// and the API read.
describe('finding identity across a re-lint', () => {
	const NOTE = ['Read that again.', '', 'Something else entirely.'].join(
		'\n',
	);
	const keys = (text: string): string[] =>
		lint(text, config).findings.flatMap((f) =>
			f.occurrences.map((o) => o.key),
		);

	it('is unchanged when the note is linted twice', () => {
		expect(keys(NOTE)).toEqual(keys(NOTE));
		expect(keys(NOTE).length).toBeGreaterThan(0);
	});

	// Prose the finding does not cover moved, and the offsets all shifted. The
	// key hashes the anchor text, not the position, so the thread survives.
	it('is unchanged when unrelated prose above it is edited', () => {
		const before = 'Read that again.\n\nShort.';
		const after =
			'Read that again.\n\nA much longer closing sentence here.';
		expect(keys(after)).toEqual(keys(before));
	});

	it('changes when the flagged phrase itself is edited', () => {
		const edited = NOTE.replace('Read that again.', 'Read that once more.');
		expect(keys(edited)).not.toEqual(keys(NOTE));
	});
});

// The keys on the raw diagnostics. The editor's hover works in diagnostics, and
// a comment promoted from it carries this key as its source key. Annoteca is
// idempotent on that key, so two findings sharing one would mean the second can
// never be promoted at all: it would look like a duplicate and be skipped.
describe('withDiagnosticKeys', () => {
	const TEXT = 'alpha bravo alpha charlie';
	const at = (ruleSlug: string, start: number, end: number) => ({
		ruleSlug,
		packId: 'base',
		severity: 'warning' as const,
		message: 'm',
		start,
		end,
	});

	it('gives different rules different keys for the same words', () => {
		const [a, b] = withDiagnosticKeys(TEXT, [
			at('one', 0, 5),
			at('two', 0, 5),
		]);
		expect(a?.key).not.toBe(b?.key);
	});

	it('gives different words different keys', () => {
		const [a, b] = withDiagnosticKeys(TEXT, [
			at('r', 0, 5),
			at('r', 6, 11),
		]);
		expect(a?.key).not.toBe(b?.key);
	});

	// Two identical phrases flagged by one rule. Only the index separates them,
	// and without it promoting the second would be treated as a duplicate.
	it('gives repeated identical phrases different keys', () => {
		const [a, b] = withDiagnosticKeys(TEXT, [
			at('r', 0, 5),
			at('r', 12, 17),
		]);
		expect(TEXT.slice(0, 5)).toBe(TEXT.slice(12, 17));
		expect(a?.key).not.toBe(b?.key);
	});

	it('numbers by position, not by the order it was handed them', () => {
		const forward = withDiagnosticKeys(TEXT, [
			at('r', 0, 5),
			at('r', 12, 17),
		]);
		const backward = withDiagnosticKeys(TEXT, [
			at('r', 12, 17),
			at('r', 0, 5),
		]);
		expect(backward[0]?.key).toBe(forward[1]?.key);
		expect(backward[1]?.key).toBe(forward[0]?.key);
	});

	it('leaves the diagnostic otherwise untouched', () => {
		const [only] = withDiagnosticKeys(TEXT, [at('r', 0, 5)]);
		expect(only?.start).toBe(0);
		expect(only?.end).toBe(5);
		expect(only?.ruleSlug).toBe('r');
	});

	// The invariant that makes promotion work: the key the hover promotes with
	// has to be the key the report and the API publish for the same hit, or a
	// consumer could never match a comment back to its finding.
	it('agrees with the key withKeys gives the same occurrence', () => {
		const diagnostics = withDiagnosticKeys(TEXT, [
			at('r', 0, 5),
			at('r', 12, 17),
		]);
		const [f] = withKeys(TEXT, [
			{
				key: '',
				ruleSlug: 'r',
				packId: 'base',
				severity: 'warning',
				message: 'm',
				occurrences: [
					{ start: 0, end: 5, key: '' },
					{ start: 12, end: 17, key: '' },
				],
				confidence: 0.9,
				priority: 9,
				rolledUp: false,
			},
		]);
		expect(f?.occurrences.map((o) => o.key)).toEqual(
			diagnostics.map((d) => d.key),
		);
	});
});
