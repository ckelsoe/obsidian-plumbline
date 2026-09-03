import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';

const config = resolveConfig('scripture-book');

describe('lint metrics', () => {
	it('computes metrics over prose only, skipping headings and code', () => {
		const text = [
			'# Heading with several extra words here',
			'',
			'```',
			'ignored code words words words words',
			'```',
			'',
			'Short. A longer sentence carrying several more words.',
		].join('\n');
		const result = lint(text, config);
		expect(result.metrics.sentences).toBe(2);
		// 'Short.' = 1, 'A longer sentence carrying several more words.' = 7.
		expect(result.metrics.words).toBe(8);
		expect(result.spans.length).toBeGreaterThan(0);
	});

	it('reports zero burstiness for uniform sentence lengths', () => {
		expect(
			lint('aa bb cc. dd ee ff. gg hh ii.', config).metrics.burstiness,
		).toBe(0);
	});

	it('reports empty metrics for text that is all protected', () => {
		const result = lint('# Only a heading', config);
		expect(result.metrics.sentences).toBe(0);
		expect(result.metrics.words).toBe(0);
		expect(result.metrics.burstiness).toBe(0);
	});
});

describe('lint diagnostics', () => {
	it('flags a blocklisted phrase with the right slug and range', () => {
		const text = 'The promise stands. Read that again.';
		const flag = lint(text, config).diagnostics.find(
			(d) => d.ruleSlug === 'reader-direction',
		);
		expect(flag).toBeDefined();
		if (flag) {
			expect(text.slice(flag.start, flag.end).toLowerCase()).toBe(
				'read that again',
			);
		}
	});

	it('does not flag phrases inside protected code', () => {
		const text = '```\nread that again\n```\nClean prose here.';
		expect(lint(text, config).diagnostics).toEqual([]);
	});

	it('does not flag phrases inside an HTML or Annoteca comment', () => {
		const text =
			'Clean prose here. <!-- annoteca/note: read that again --> More clean prose.';
		expect(lint(text, config).diagnostics).toEqual([]);
	});

	it('has no diagnostics for clean prose', () => {
		expect(
			lint('He kept the promise he made.', config).diagnostics,
		).toEqual([]);
	});

	it('does not fire a heuristic the vault config disables', () => {
		const text = 'This shows the point.';
		expect(lint(text, config).diagnostics.map((d) => d.ruleSlug)).toContain(
			'demonstrative-opener',
		);
		const disabled = resolveConfig('scripture-book', {
			disabledRules: ['demonstrative-opener'],
			rules: [],
			overrides: {},
		});
		expect(
			lint(text, disabled).diagnostics.map((d) => d.ruleSlug),
		).not.toContain('demonstrative-opener');
	});
});

describe('lint with the scripture profile', () => {
	it('does not flag AI-tell phrases inside a quoted verse', () => {
		const text =
			'As it says, "Delve into wisdom and understanding." (Proverbs 2:2, ESV) He obeyed.';
		const slugs = lint(text, config).diagnostics.map((d) => d.ruleSlug);
		expect(slugs).not.toContain('flagged-register');
	});

	it('still flags the same phrase outside a quoted verse', () => {
		const text = 'We delve into it. "It is finished." (John 19:30, ESV)';
		const slugs = lint(text, config).diagnostics.map((d) => d.ruleSlug);
		expect(slugs).toContain('flagged-register');
	});

	it('flags devotional register creep', () => {
		const slugs = lint(
			'This passage invites us to lean into grace.',
			config,
		).diagnostics.map((d) => d.ruleSlug);
		expect(slugs).toContain('devotional-register');
	});
});
