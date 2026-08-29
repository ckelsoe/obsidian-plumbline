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

	it('has no diagnostics for clean prose', () => {
		expect(
			lint('He kept the promise he made.', config).diagnostics,
		).toEqual([]);
	});
});
