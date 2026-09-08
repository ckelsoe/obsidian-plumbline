import { buildReport, REPORT_SCHEMA_VERSION } from '../report';
import { LintResult } from '../engine/types';

const result: LintResult = {
	metrics: {
		sentences: 2,
		words: 10,
		meanSentenceLength: 5,
		burstiness: 0.4,
	},
	spans: [],
	// The rolled-up view and the per-hit view describe the same single hit here,
	// which is what buildReport has to carry through to both of its lists.
	findings: [
		{
			key: 'f-rd',
			ruleSlug: 'reader-direction',
			packId: 'base',
			severity: 'warning',
			message: 'Cut it.',
			occurrences: [{ start: 12, end: 27, key: 'krd' }],
			confidence: 0.9,
			priority: 9,
			rolledUp: false,
		},
	],
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
		// Tied to the constant, so a shape change that forgets to bump it
		// fails here rather than shipping an unversioned change.
		expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
		expect(REPORT_SCHEMA_VERSION).toBe(3);

		// Ranked, one row per rule, every occurrence under it.
		expect(report.findings).toHaveLength(1);
		const finding = report.findings[0];
		expect(finding).toBeDefined();
		if (finding) {
			expect(finding.ruleSlug).toBe('reader-direction');
			expect(finding.rolledUp).toBe(false);
			expect(finding.occurrences).toHaveLength(1);
			expect(finding.occurrences[0]?.line).toBe(2);
			expect(finding.occurrences[0]?.text).toBe('Read that again');
			// Schema 3: identity travels with the report, so a headless
			// consumer can tell a finding it already acted on from a new one
			// without comparing offsets that any edit above moves.
			expect(finding.key).toBe('f-rd');
			expect(finding.occurrences[0]?.key).toBe('krd');
		}

		// The per-hit list is still there, because the rolled-up view cannot be
		// un-rolled and a positional consumer needs it.
		expect(report.hits).toHaveLength(1);
		expect(report.hits[0]?.line).toBe(2);
		expect(report.hits[0]?.text).toBe('Read that again');
	});
});
