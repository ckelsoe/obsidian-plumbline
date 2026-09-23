import { applyRules } from '../engine/apply-rules';
import {
	buildTermRules,
	describeTermList,
	parseTermList,
} from '../engine/term-list';

const BRAND = `---
tags: brand
---
# Brand: Acme

## Product Names

| Product Name | Do NOT Use |
|-------------|------------|
| Plumbline | PlumbLine, Plumb Line |
| | |

## Domain Jargon Replacements

| Jargon | Plain Replacement |
|--------|-------------------|
| utilize | use |

## Pronouns (Override)

- Use "we" for the company.
`;

const PHRASES = `# Phrases to Remove

## Throat-Clearing Openers

- "Here's the thing:"
- "Here's what [X]"
- "Full stop." / "Period."

## Business Jargon

| Avoid | Use instead |
|-------|-------------|
| leverage | use |
`;

describe('parseTermList', () => {
	it('reads brand.md tables by header, whichever column comes first', () => {
		expect(parseTermList(BRAND)).toEqual([
			{
				term: 'PlumbLine',
				replacement: 'Plumbline',
				caseSensitive: true,
			},
			{
				term: 'Plumb Line',
				replacement: 'Plumbline',
				caseSensitive: false,
			},
			{ term: 'utilize', replacement: 'use', caseSensitive: false },
		]);
	});

	it('ignores empty template rows and unquoted guidance bullets', () => {
		const terms = parseTermList(BRAND).map((e) => e.term);
		expect(terms).not.toContain('we');
		expect(terms).not.toContain('');
	});

	it('reads quoted bullets, cutting at a [X] placeholder', () => {
		expect(parseTermList(PHRASES).map((e) => e.term)).toEqual([
			"Here's the thing:",
			"Here's what",
			'Full stop.',
			'Period.',
			'leverage',
		]);
	});

	it('skips a table with no column to avoid', () => {
		expect(
			parseTermList('| Color | Hex |\n|---|---|\n| Red | #f00 |\n'),
		).toEqual([]);
	});

	it('keeps the first entry for a term listed twice', () => {
		const md =
			'| Avoid | Use |\n|---|---|\n| utilize | use |\n| Utilize | employ |\n';
		expect(parseTermList(md)).toEqual([
			{ term: 'utilize', replacement: 'use', caseSensitive: false },
		]);
	});

	it('drops a row whose term and replacement are identical', () => {
		expect(
			parseTermList('| Avoid | Use |\n|---|---|\n| use | use |\n'),
		).toEqual([]);
	});
});

describe('buildTermRules', () => {
	const lint = (text: string, rules: ReturnType<typeof buildTermRules>) =>
		applyRules(text, rules);

	it('flags a banned term and offers its replacement, naming the list', () => {
		const rules = buildTermRules([
			{ name: 'Company voice', entries: parseTermList(BRAND) },
		]);
		const [hit] = lint('We utilize tools.', rules);
		expect(hit?.message).toBe('Company voice: use "use" instead.');
		expect(hit?.fixOptions).toEqual([
			{ text: 'use', source: 'Company voice' },
		]);
	});

	it('matches a case-only product-name error exactly, never the right spelling', () => {
		const rules = buildTermRules([
			{ name: 'Company voice', entries: parseTermList(BRAND) },
		]);
		expect(lint('Plumbline is great.', rules)).toEqual([]);
		const [hit] = lint('PlumbLine is great.', rules);
		expect(hit?.fixOptions).toEqual([
			{ text: 'Plumbline', source: 'Company voice' },
		]);
	});

	it('shows every suggestion when lists disagree, each with its list', () => {
		const rules = buildTermRules([
			{
				name: 'Company voice',
				entries: [
					{
						term: 'utilize',
						replacement: 'use',
						caseSensitive: false,
					},
				],
			},
			{
				name: 'Client style',
				entries: [
					{
						term: 'utilize',
						replacement: 'employ',
						caseSensitive: false,
					},
				],
			},
		]);
		expect(rules).toHaveLength(1);
		const [hit] = lint('Utilize it.', rules);
		expect(hit?.message).toBe(
			'The term lists disagree: Company voice suggests "use"; Client style suggests "employ". Pick one.',
		);
		expect(hit?.fixOptions).toEqual([
			{ text: 'Use', source: 'Company voice' },
			{ text: 'Employ', source: 'Client style' },
		]);
	});

	it('collapses the same term in two lists into one finding naming both', () => {
		const same = [
			{ term: 'leverage', replacement: 'use', caseSensitive: false },
		];
		const rules = buildTermRules([
			{ name: 'A', entries: same },
			{ name: 'B', entries: same },
		]);
		const hits = lint('We leverage it.', rules);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.message).toBe('A, B: use "use" instead.');
	});

	it('flags a phrase with no replacement, and punctuation-ended phrases match', () => {
		const rules = buildTermRules([
			{ name: 'Phrases', entries: parseTermList(PHRASES) },
		]);
		const hits = lint("Here's the thing: it works. Full stop.", rules);
		expect(hits.map((h) => h.message)).toEqual([
			'Phrases: avoid this phrase.',
			'Phrases: avoid this phrase.',
		]);
		expect(hits[0]?.fixOptions).toBeUndefined();
	});

	it('matches a straight-apostrophe term against curly-apostrophe prose', () => {
		const rules = buildTermRules([
			{ name: 'Phrases', entries: parseTermList(PHRASES) },
		]);
		expect(lint('Here’s the thing: yes.', rules)).toHaveLength(1);
	});
});

describe('describeTermList', () => {
	it('summarises the count and how many carry a replacement', () => {
		expect(describeTermList(parseTermList(BRAND))).toBe(
			'3 terms, 3 with a replacement.',
		);
		expect(describeTermList([])).toBe('0 terms, none with a replacement.');
	});
});

describe('placeholders', () => {
	it('matches a mid-phrase [X] as any one word, and not the bare stem', () => {
		const rules = buildTermRules([
			{
				name: 'Phrases',
				entries: parseTermList('- "The real [X] is"\n'),
			},
		]);
		expect(applyRules('The real problem is time.', rules)).toHaveLength(1);
		expect(applyRules('That was the real deal.', rules)).toEqual([]);
	});

	it('drops a trailing placeholder, whatever it is called', () => {
		expect(parseTermList('- "Here\'s why [reason]"\n')[0]?.term).toBe(
			"Here's why",
		);
	});
});

describe('review fixes', () => {
	it('offers a placeholder term’s replacement on the expanded match', () => {
		const rules = buildTermRules([
			{
				name: 'Voice',
				entries: parseTermList(
					'| Avoid | Use instead |\n|---|---|\n| The real [X] is | Actually |\n',
				),
			},
		]);
		const [hit] = applyRules('The real problem is scope.', rules);
		expect(hit?.fixOptions).toEqual([
			{ text: 'Actually', source: 'Voice' },
		]);
	});

	it('gives "foo bar" and "foo-bar" distinct slugs whatever the order', () => {
		const one = (terms: string[]) =>
			buildTermRules([
				{
					name: 'L',
					entries: terms.map((term) => ({
						term,
						caseSensitive: false,
					})),
				},
			]).map((r) => [r.phrases[0], r.slug]);
		const forward = new Map(
			one(['foo bar', 'foo-bar']) as [string, string][],
		);
		const backward = new Map(
			one(['foo-bar', 'foo bar']) as [string, string][],
		);
		expect(forward.get('foo bar')).toBe('term-foo-bar');
		expect(forward).toEqual(backward);
		expect(forward.get('foo-bar')).not.toBe('term-foo-bar');
	});

	it('does not match a term glued to an accented letter', () => {
		const rules = buildTermRules([
			{
				name: 'L',
				entries: [
					{ term: 'éclair', caseSensitive: false },
					{ term: 'clair', caseSensitive: false },
				],
			},
		]);
		expect(
			applyRules('Un méclair et éclair.', rules).map((d) => d.start),
		).toEqual([14]);
	});
});
