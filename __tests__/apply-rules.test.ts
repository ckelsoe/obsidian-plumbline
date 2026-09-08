import { applyRules, matchCase } from '../engine/apply-rules';
import { BASE_RULES } from '../engine/packs';

describe('applyRules', () => {
	it('flags a reader-direction phrase with its slug, range, and metadata', () => {
		const text = 'The verse is clear. Read that again.';
		const diags = applyRules(text, BASE_RULES);
		const flag = diags.find((d) => d.ruleSlug === 'reader-direction');
		expect(flag).toBeDefined();
		if (flag) {
			expect(text.slice(flag.start, flag.end).toLowerCase()).toBe(
				'read that again',
			);
			expect(flag.severity).toBe('warning');
			expect(flag.packId).toBe('base');
		}
	});

	it('flags flagged-register vocabulary', () => {
		const slugs = applyRules(
			'We delve into the tapestry of grace.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('flagged-register');
	});

	it('respects word boundaries', () => {
		// "meticulously" contains "meticulous" but is not the flagged word.
		const diags = applyRules('He worked meticulously.', BASE_RULES);
		expect(diags.some((d) => d.ruleSlug === 'flagged-register')).toBe(
			false,
		);
	});

	it('is case-insensitive', () => {
		const diags = applyRules('DELVE into it.', BASE_RULES);
		expect(diags.some((d) => d.ruleSlug === 'flagged-register')).toBe(true);
	});

	it('returns diagnostics sorted by position', () => {
		const text = 'Delve first. Then read that again.';
		const positions = applyRules(text, BASE_RULES).map((d) => d.start);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it('has no diagnostics for clean prose', () => {
		expect(applyRules('He kept the promise he made.', BASE_RULES)).toEqual(
			[],
		);
	});

	it('flags a summative closer', () => {
		const slugs = applyRules(
			'In essence, the point is grace.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('summative-closer');
	});

	it('flags a cinematic opener', () => {
		const slugs = applyRules(
			'In a world where doubt is easy, he believed.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs).toContain('cinematic-opener');
	});

	it('flags the extended vocabulary', () => {
		const slugs = applyRules(
			'We leverage a seamless plan.',
			BASE_RULES,
		).map((d) => d.ruleSlug);
		expect(slugs.filter((s) => s === 'flagged-register').length).toBe(2);
	});

	it('flags hollow attribution', () => {
		expect(
			applyRules('Scholars note that this is late.', BASE_RULES).map(
				(d) => d.ruleSlug,
			),
		).toContain('hollow-attribution');
	});

	it('flags placeholder memory', () => {
		expect(
			applyRules('At one point I struggled with this.', BASE_RULES).map(
				(d) => d.ruleSlug,
			),
		).toContain('placeholder-memory');
	});

	it('flags rating your own point', () => {
		expect(
			applyRules('The contrast is stark here.', BASE_RULES).map(
				(d) => d.ruleSlug,
			),
		).toContain('impact-self-rating');
	});

	it('flags a trailing participial after a comma', () => {
		const diags = applyRules(
			'David returns four times, creating a sense of grief.',
			BASE_RULES,
		);
		expect(diags.map((d) => d.ruleSlug)).toContain('trailing-participial');
	});

	it('does not flag a participle that is not comma-prefixed', () => {
		expect(
			applyRules('Creating art is hard work.', BASE_RULES).map(
				(d) => d.ruleSlug,
			),
		).not.toContain('trailing-participial');
	});
});

// The replacement a finding can offer. Only some phrases have one: "leverage"
// has a plain equivalent and "intricate" does not, and a confident wrong
// suggestion costs the writer their own phrasing.
describe('applyRules: replacements', () => {
	const fixFor = (text: string): string | undefined =>
		applyRules(text, BASE_RULES).find((d) => d.fix !== undefined)?.fix;

	it('carries the replacement for a phrase that has one', () => {
		expect(fixFor('They leverage the tool.')).toBe('use');
		expect(fixFor('A myriad of options.')).toBe('many');
	});

	it('offers nothing for a phrase with no single right word', () => {
		const found = applyRules('An intricate tapestry.', BASE_RULES);
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((d) => d.fix === undefined)).toBe(true);
	});

	// The phrase list is matched case-insensitively, so a sentence-opening word
	// matches its lower-case entry. Substituting the raw replacement would
	// quietly lower-case the writer's first word.
	it('carries the capitalisation of the word it replaces', () => {
		expect(fixFor('Leverage the tool.')).toBe('Use');
	});

	it('matches the inflected form, not just the base word', () => {
		expect(fixFor('She leveraged it.')).toBe('used');
		expect(fixFor('They are leveraging it.')).toBe('using');
	});
});

describe('matchCase', () => {
	it('leaves a lower-case match alone', () => {
		expect(matchCase('leverage', 'use')).toBe('use');
	});

	it('capitalises for a capitalised match', () => {
		expect(matchCase('Leverage', 'use')).toBe('Use');
	});

	// An all-caps match is shouting; its replacement should not inherit that,
	// only the leading capital.
	it('does not shout back at an all-caps match', () => {
		expect(matchCase('LEVERAGE', 'use')).toBe('Use');
	});

	it('handles an empty match without throwing', () => {
		expect(matchCase('', 'use')).toBe('use');
	});

	// A match starting with a non-letter has no case to carry.
	it('leaves the replacement alone when the match starts with punctuation', () => {
		expect(matchCase('"leverage', 'use')).toBe('use');
	});
});

// Plain-word substitutions. Every entry has ONE right answer, which is what
// earns it a one-click fix; anything context-dependent belongs in
// flagged-register with no replacement.
describe('wordy-substitute', () => {
	const fixFor = (text: string): string | undefined =>
		applyRules(text, BASE_RULES).find(
			(d) => d.ruleSlug === 'wordy-substitute',
		)?.fix;

	it('offers the shorter word', () => {
		expect(fixFor('We utilize the tool.')).toBe('use');
		expect(fixFor('This will facilitate the work.')).toBe('help');
		expect(fixFor('A note regarding the draft.')).toBe('about');
		expect(fixFor('Prior to the meeting.')).toBe('Before');
	});

	it('handles the multi-word ones', () => {
		expect(fixFor('Due to the fact that it rained.')).toBe('Because');
		expect(fixFor('In order to finish.')).toBe('To');
		expect(fixFor('At this point in time we stop.')).toBe('Now');
	});

	it('matches inflected forms', () => {
		expect(fixFor('She utilized it.')).toBe('used');
		expect(fixFor('They are utilizing it.')).toBe('using');
	});

	// Every phrase in the rule must have a replacement, or the rule promises a
	// fix it cannot give. This one is a substitution list by definition.
	it('has a replacement for every phrase it flags', () => {
		const rule = BASE_RULES.find((r) => r.slug === 'wordy-substitute');
		expect(rule).toBeDefined();
		for (const phrase of rule?.phrases ?? []) {
			expect(rule?.replace?.[phrase]).toBeDefined();
		}
	});
});

// Only the doubled hedges get a fix: dropping the second word leaves the
// meaning untouched. The rest ask the writer to decide what they mean.
describe('hedge-stack replacements', () => {
	const diagnosticsFor = (text: string) =>
		applyRules(text, BASE_RULES).filter(
			(d) => d.ruleSlug === 'hedge-stack',
		);

	it('drops the redundant half of a doubled hedge', () => {
		expect(diagnosticsFor('It may perhaps rain.')[0]?.fix).toBe('may');
		expect(diagnosticsFor('It could potentially rain.')[0]?.fix).toBe(
			'could',
		);
	});

	it('offers nothing where the writer has to decide', () => {
		expect(diagnosticsFor('It works to some extent.')[0]?.fix).toBe(
			undefined,
		);
		expect(diagnosticsFor('Generally speaking, it works.')[0]?.fix).toBe(
			undefined,
		);
	});
});
