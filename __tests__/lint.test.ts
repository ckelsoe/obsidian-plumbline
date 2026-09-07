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

	it('lints plain HTML comments when that masking is off, Annoteca still masked', () => {
		const cfg = resolveConfig('scripture-book', {
			disabledRules: [],
			disabledSpanKinds: ['html-comment'],
			rules: [],
			overrides: {},
		});
		expect(
			lint('<!-- read that again -->', cfg).diagnostics.map(
				(d) => d.ruleSlug,
			),
		).toContain('reader-direction');
		expect(
			lint(
				'<!-- annoteca/note: read that again -->',
				cfg,
			).diagnostics.map((d) => d.ruleSlug),
		).not.toContain('reader-direction');
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
			disabledSpanKinds: [],
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

// PL-D. The scoping decision is made inside lint(), so the editor, the CLI and
// the JSON report cannot disagree about which rules ran on a note. These drive
// it through lint() for that reason, rather than through fileScope() alone.
//
// `reader-direction` is a mechanical rule the config carries and `anaphora` is a
// heuristic, so both filtering paths are exercised.
describe('lint per-file scoping', () => {
	const ANAPHORA = [
		'The Lord is near. The Lord is kind. The Lord is faithful.',
		'The Lord is good.',
	].join(' ');
	const slugs = (text: string): string[] => [
		...new Set(lint(text, config).diagnostics.map((d) => d.ruleSlug)),
	];

	it('runs both rules with no scoping, which the rest of these rely on', () => {
		expect(slugs(`Read that again.\n\n${ANAPHORA}`).sort()).toEqual([
			'anaphora',
			'reader-direction',
		]);
	});

	it('disables a mechanical rule from frontmatter', () => {
		const text = [
			'---',
			'plumbline-disabled-rules: [reader-direction]',
			'---',
			'Read that again.',
			'',
			ANAPHORA,
		].join('\n');
		expect(slugs(text)).toEqual(['anaphora']);
	});

	it('disables a heuristic from a directive', () => {
		const text = [
			'<!-- plumbline: disable anaphora -->',
			'Read that again.',
			'',
			ANAPHORA,
		].join('\n');
		expect(slugs(text)).toEqual(['reader-direction']);
	});

	it('returns no diagnostics when the note opts out entirely', () => {
		const text = [
			'---',
			'plumbline-disabled-rules: all',
			'---',
			'Read that again.',
			'',
			ANAPHORA,
		].join('\n');
		const result = lint(text, config);
		expect(result.diagnostics).toEqual([]);
		expect(result.findings).toEqual([]);
		// Metrics still describe the prose. Opting out of the rules is not opting
		// out of being counted, and the rhythm panel keeps working.
		expect(result.metrics.sentences).toBeGreaterThan(0);
	});

	it('does not flag inside a skipped region, and still flags outside it', () => {
		const text = [
			'<!-- plumbline: off -->',
			'Read that again.',
			'<!-- plumbline: on -->',
			'',
			'Read that again.',
		].join('\n');
		const hits = lint(text, config).diagnostics.filter(
			(d) => d.ruleSlug === 'reader-direction',
		);
		expect(hits).toHaveLength(1);
		// The surviving hit is the one AFTER the region, not the one inside it.
		expect(hits[0]?.start).toBeGreaterThan(text.indexOf('plumbline: on'));
	});

	// A skipped region is masked rather than filtered afterwards, so it is
	// invisible to the rhythm metrics too. Burstiness computed over prose the
	// writer excluded is a wrong number, not a filtered one.
	it('leaves a skipped region out of the metrics', () => {
		const prose = 'Sentences here carry seven words each time.';
		const plain = lint(prose, config).metrics;
		const scoped = lint(
			`<!-- plumbline: off -->\nIgnored words go here.\n<!-- plumbline: on -->\n\n${prose}`,
			config,
		).metrics;
		expect(scoped.words).toBe(plain.words);
		expect(scoped.sentences).toBe(plain.sentences);
	});
});
