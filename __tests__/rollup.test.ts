import {
	CONFIDENCE,
	DEFAULT_ROLLUP_THRESHOLD,
	confidenceFor,
	priorityOf,
	rollup,
} from '../engine/rollup';
import { Diagnostic, Severity } from '../engine/types';

const hit = (
	slug: string,
	start: number,
	severity: Severity = 'warning',
): Diagnostic => ({
	ruleSlug: slug,
	packId: 'base',
	severity,
	start,
	end: start + 5,
	message: `${slug} message`,
});

const config = (
	rollupThreshold = DEFAULT_ROLLUP_THRESHOLD,
	rollupBySlug: Record<string, number> = {},
) => ({
	rollupThreshold,
	confidenceBySlug: {},
	rollupBySlug,
});

const flat = () => CONFIDENCE.mechanical;

// Distinct five-character words at offsets 0, 10, 20, 30 and 40, matching the
// ranges `hit` produces, so every occurrence hashes to its own key rather than
// every one of them hashing the empty string.
const TEXT = 'aaaaa     bbbbb     ccccc     ddddd     eeeee     ';

describe('rollup: grouping', () => {
	it('gives one finding per rule, carrying every occurrence', () => {
		const out = rollup(
			TEXT,
			[hit('a', 0), hit('a', 10), hit('b', 20)],
			config(),
			flat,
		);
		expect(out).toHaveLength(2);
		const a = out.find((f) => f.ruleSlug === 'a');
		expect(
			a?.occurrences.map((o) => ({ start: o.start, end: o.end })),
		).toEqual([
			{ start: 0, end: 5 },
			{ start: 10, end: 15 },
		]);
	});

	// The point of the release: a rule firing through a chapter becomes one row.
	it('marks a rule past the threshold as rolled up, keeping every occurrence', () => {
		const hits = [0, 10, 20, 30, 40].map((n) => hit('a', n));
		const [only] = rollup(TEXT, hits, config(4), flat);
		expect(only?.rolledUp).toBe(true);
		expect(only?.occurrences).toHaveLength(5);
	});

	it('leaves a rule at the threshold unrolled', () => {
		const hits = [0, 10, 20, 30].map((n) => hit('a', n));
		expect(rollup(TEXT, hits, config(4), flat)[0]?.rolledUp).toBe(false);
	});

	it('honours a per-profile threshold', () => {
		const hits = [0, 10].map((n) => hit('a', n));
		expect(rollup(TEXT, hits, config(1), flat)[0]?.rolledUp).toBe(true);
		expect(rollup(TEXT, hits, config(9), flat)[0]?.rolledUp).toBe(false);
	});

	// A noisy check can collapse sooner than the group default; another check in
	// the same note keeps the group threshold.
	it('honours a per-check threshold override', () => {
		const hits = [
			...[0, 10, 20].map((n) => hit('noisy', n)),
			...[30, 40].map((n) => hit('calm', n)),
		];
		const out = rollup(TEXT, hits, config(4, { noisy: 2 }), flat);
		expect(out.find((f) => f.ruleSlug === 'noisy')?.rolledUp).toBe(true);
		expect(out.find((f) => f.ruleSlug === 'calm')?.rolledUp).toBe(false);
	});

	// The per-check override is floored at 1 like the group threshold, so a bad
	// value never rolls up a lone hit.
	it('floors a per-check override at 1', () => {
		expect(
			rollup(TEXT, [hit('a', 0)], config(4, { a: 0 }), flat)[0]?.rolledUp,
		).toBe(false);
	});

	// A threshold under 1 would roll up a single hit, which reads worse than the
	// hit itself.
	it('never rolls up a lone hit, whatever the threshold says', () => {
		expect(rollup(TEXT, [hit('a', 0)], config(0), flat)[0]?.rolledUp).toBe(
			false,
		);
		expect(rollup(TEXT, [hit('a', 0)], config(-5), flat)[0]?.rolledUp).toBe(
			false,
		);
	});

	it('returns nothing for no hits', () => {
		expect(rollup(TEXT, [], config(), flat)).toEqual([]);
	});
});

describe('rollup: ranking', () => {
	it('puts one error above many suggestions', () => {
		const out = rollup(
			TEXT,
			[
				hit('err', 100, 'error'),
				...[0, 10, 20, 30].map((n) => hit('sugg', n, 'suggestion')),
			],
			config(),
			flat,
		);
		expect(out[0]?.ruleSlug).toBe('err');
	});

	it('ranks a repeated rule above a single hit of the same severity', () => {
		const out = rollup(
			TEXT,
			[hit('once', 0), hit('often', 10), hit('often', 20)],
			config(),
			flat,
		);
		expect(out.map((f) => f.ruleSlug)).toEqual(['often', 'once']);
	});

	// The reason confidence exists: a judgment-tier note should not outrank a
	// mechanical rule just by firing more often.
	it('lets confidence outweigh a higher count', () => {
		const out = rollup(
			TEXT,
			[hit('mech', 0), hit('judg', 10), hit('judg', 20)],
			config(),
			(slug) =>
				slug === 'mech' ? CONFIDENCE.mechanical : CONFIDENCE.judgment,
		);
		expect(out.map((f) => f.ruleSlug)).toEqual(['mech', 'judg']);
	});

	// Map iteration order is insertion order, which would make equal-priority
	// output depend on which rule happened to fire first.
	it('breaks ties by position, then by slug', () => {
		const out = rollup(
			TEXT,
			[hit('zebra', 50), hit('alpha', 10)],
			config(),
			flat,
		);
		expect(out.map((f) => f.ruleSlug)).toEqual(['alpha', 'zebra']);
	});
});

describe('confidenceFor', () => {
	it('prefers a vault override, then the record, then the default', () => {
		expect(confidenceFor('a', 0.5, 0.9, { a: 0.2 })).toBe(0.2);
		expect(confidenceFor('a', 0.5, 0.9, {})).toBe(0.5);
		expect(confidenceFor('a', undefined, 0.9, {})).toBe(0.9);
	});

	// The override comes from a hand-edited JSON file, so it is clamped rather
	// than trusted: a negative would invert the ranking and a large one would
	// dominate it.
	it('clamps an out-of-range override into 0..1', () => {
		expect(confidenceFor('a', undefined, 0.9, { a: 5 })).toBe(1);
		expect(confidenceFor('a', undefined, 0.9, { a: -3 })).toBe(0);
	});

	it('falls back when the value is not a usable number', () => {
		expect(confidenceFor('a', undefined, 0.9, { a: NaN })).toBe(0.9);
	});

	// An explicit zero is a real answer ("never rank this up"), not a missing one,
	// so it must not fall through to the default the way undefined does.
	it('treats an explicit zero as a value', () => {
		expect(confidenceFor('a', 0, 0.9, {})).toBe(0);
		expect(confidenceFor('a', undefined, 0.9, { a: 0 })).toBe(0);
	});
});

describe('priorityOf', () => {
	it('multiplies severity weight, count and confidence', () => {
		expect(priorityOf('warning', 3, 0.5)).toBe(15);
		expect(priorityOf('suggestion', 1, 1)).toBe(1);
	});

	it('separates the severities by a wide enough margin to matter', () => {
		expect(priorityOf('error', 1, 1)).toBeGreaterThan(
			priorityOf('warning', 9, 1),
		);
		expect(priorityOf('warning', 1, 1)).toBeGreaterThan(
			priorityOf('suggestion', 9, 1),
		);
	});
});
