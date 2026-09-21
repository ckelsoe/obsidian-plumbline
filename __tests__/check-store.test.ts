import {
	CustomCheck,
	customCheckToRule,
	parseUserChecks,
	serializeUserChecks,
	findCustomCheck,
	isBuiltInSlug,
	CUSTOM_PACK_ID,
} from '../engine/check-store';

const customCheck = (over: Partial<CustomCheck> = {}): CustomCheck => ({
	slug: 'corporate-jargon',
	name: 'Corporate jargon',
	message: 'Say it plainly.',
	category: CUSTOM_PACK_ID,
	severity: 'suggestion',
	phrases: ['circle back', 'move the needle'],
	...over,
});

describe('isBuiltInSlug', () => {
	it('is true for a base, heuristic, or scripture slug and false for a custom one', () => {
		expect(isBuiltInSlug('reader-direction')).toBe(true); // base mechanical
		expect(isBuiltInSlug('emphasis-fragment')).toBe(true); // heuristic
		expect(isBuiltInSlug('devotional-register')).toBe(true); // scripture
		expect(isBuiltInSlug('corporate-jargon')).toBe(false);
	});
});

describe('parseUserChecks', () => {
	it('returns an empty list for anything that is not an array', () => {
		expect(parseUserChecks(null)).toEqual([]);
		expect(parseUserChecks({})).toEqual([]);
		expect(parseUserChecks('nope')).toEqual([]);
	});

	it('parses a well-formed check and keeps a finite confidence', () => {
		const [check] = parseUserChecks([
			{
				slug: 'corporate-jargon',
				name: 'Corporate jargon',
				message: 'Say it plainly.',
				category: 'custom',
				severity: 'warning',
				phrases: ['circle back'],
				confidence: 0.5,
			},
		]);
		expect(check).toEqual({
			slug: 'corporate-jargon',
			name: 'Corporate jargon',
			message: 'Say it plainly.',
			category: 'custom',
			severity: 'warning',
			phrases: ['circle back'],
			confidence: 0.5,
		});
	});

	it('defaults category and severity, and drops a non-finite confidence', () => {
		const [check] = parseUserChecks([
			{
				slug: 'x',
				name: 'X',
				message: 'msg',
				severity: 'loud',
				phrases: ['a', 2, 'b'],
				confidence: 'high',
			},
		]);
		expect(check?.category).toBe(CUSTOM_PACK_ID);
		expect(check?.severity).toBe('suggestion');
		// Non-string phrases are dropped, and a bad confidence is not carried.
		expect(check?.phrases).toEqual(['a', 'b']);
		expect(check?.confidence).toBeUndefined();
	});

	it('drops a check with no slug, no name, or no message', () => {
		expect(
			parseUserChecks([
				{ name: 'no slug', message: 'm' },
				{ slug: 'no-name', message: 'm' },
				{ slug: 'no-message', name: 'N' },
			]),
		).toEqual([]);
	});

	it('drops a check whose slug collides with a built-in', () => {
		const parsed = parseUserChecks([
			{ slug: 'reader-direction', name: 'Shadow', message: 'm' },
			{
				slug: 'emphasis-fragment',
				name: 'Shadow heuristic',
				message: 'm',
			},
			{ slug: 'mine', name: 'Mine', message: 'm' },
		]);
		expect(parsed.map((c) => c.slug)).toEqual(['mine']);
	});

	it('drops empty phrases, which would build a zero-width matcher', () => {
		const [check] = parseUserChecks([
			{
				slug: 'x',
				name: 'X',
				message: 'm',
				phrases: ['', 'circle back', ''],
			},
		]);
		expect(check?.phrases).toEqual(['circle back']);
	});

	it('keeps the first of two checks sharing a slug', () => {
		const parsed = parseUserChecks([
			{ slug: 'dup', name: 'First', message: 'm' },
			{ slug: 'dup', name: 'Second', message: 'm' },
		]);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.name).toBe('First');
	});
});

describe('serializeUserChecks', () => {
	it('round-trips a check and omits an unset confidence', () => {
		const check = customCheck();
		const json = serializeUserChecks([check]);
		expect(json).not.toContain('confidence');
		const [back] = parseUserChecks(JSON.parse(json));
		expect(back).toEqual(check);
	});

	it('writes a set confidence', () => {
		const json = serializeUserChecks([customCheck({ confidence: 0.4 })]);
		expect(JSON.parse(json)[0].confidence).toBe(0.4);
	});
});

describe('customCheckToRule', () => {
	it('maps to a custom-pack Rule and copies the phrase list', () => {
		const check = customCheck();
		const rule = customCheckToRule(check);
		expect(rule).toEqual({
			slug: 'corporate-jargon',
			packId: CUSTOM_PACK_ID,
			category: CUSTOM_PACK_ID,
			severity: 'suggestion',
			message: 'Say it plainly.',
			phrases: ['circle back', 'move the needle'],
		});
		// The phrase array is copied, not shared with the stored check.
		expect(rule.phrases).not.toBe(check.phrases);
	});

	it('carries confidence only when the check sets it', () => {
		expect(customCheckToRule(customCheck()).confidence).toBeUndefined();
		expect(
			customCheckToRule(customCheck({ confidence: 0.4 })).confidence,
		).toBe(0.4);
	});
});

describe('findCustomCheck', () => {
	it('finds a check by slug or returns undefined', () => {
		const checks = [customCheck()];
		expect(findCustomCheck('corporate-jargon', checks)?.name).toBe(
			'Corporate jargon',
		);
		expect(findCustomCheck('nope', checks)).toBeUndefined();
	});
});
