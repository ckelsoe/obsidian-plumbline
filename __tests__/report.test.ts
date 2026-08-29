import { buildReport } from '../report';
import { LintResult } from '../engine/types';

const result: LintResult = {
	metrics: {
		sentences: 2,
		words: 10,
		meanSentenceLength: 5,
		burstiness: 0.4,
	},
	spans: [],
	diagnostics: [
		{
			ruleSlug: 'reader-direction',
			packId: 'base',
			severity: 'warning',
			start: 12,
			end: 27,
			message: 'Cut it.',
		},
	],
};

describe('buildReport', () => {
	it('includes file, profile, metrics, and findings with line and text', () => {
		const text = 'First line.\nRead that again here.';
		const report = buildReport(
			'chapters/ch01.md',
			'scripture-book',
			text,
			result,
		);
		expect(report.file).toBe('chapters/ch01.md');
		expect(report.profile).toBe('scripture-book');
		expect(report.metrics.sentences).toBe(2);
		expect(report.findings).toHaveLength(1);
		const finding = report.findings[0];
		expect(finding).toBeDefined();
		if (finding) {
			expect(finding.ruleSlug).toBe('reader-direction');
			expect(finding.line).toBe(2);
			expect(finding.text).toBe('Read that again');
		}
	});
});
