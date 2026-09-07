import { rhythmStatusText, rhythmDetail } from '../rhythm-format';
import { LintResult, Metrics } from '../engine/types';

function result(metrics: Metrics, flags = 0): LintResult {
	return {
		metrics,
		spans: [],
		findings: [],
		diagnostics: Array.from({ length: flags }, (_, i) => ({
			ruleSlug: 'reader-direction',
			severity: 'warning' as const,
			start: i,
			end: i + 1,
			message: 'x',
			packId: 'base',
		})),
	};
}

const sample: Metrics = {
	sentences: 12,
	words: 200,
	meanSentenceLength: 16.7,
	burstiness: 0.83,
};

const empty: Metrics = {
	sentences: 0,
	words: 0,
	meanSentenceLength: 0,
	burstiness: 0,
};

describe('rhythmStatusText', () => {
	it('shows the burstiness when there are no flags', () => {
		expect(rhythmStatusText(result(sample, 0))).toBe('Rhythm 0.83 CV');
	});

	it('appends the flag count when there are flags', () => {
		expect(rhythmStatusText(result(sample, 3))).toBe(
			'Rhythm 0.83 CV, 3 flags',
		);
	});

	it('uses the singular for one flag', () => {
		expect(rhythmStatusText(result(sample, 1))).toBe(
			'Rhythm 0.83 CV, 1 flag',
		);
	});

	it('reports no prose when there are no sentences', () => {
		expect(rhythmStatusText(result(empty, 0))).toBe('Rhythm: no prose');
	});
});

describe('rhythmDetail', () => {
	it('lists the metrics and the flag count', () => {
		expect(rhythmDetail(result(sample, 2))).toBe(
			[
				'Burstiness (CV): 0.83',
				'Sentences: 12',
				'Words: 200',
				'Mean sentence length: 16.7',
				'Flags: 2',
			].join('\n'),
		);
	});

	it('reports no prose for empty metrics', () => {
		expect(rhythmDetail(result(empty, 0))).toBe(
			'No prose found in this note.',
		);
	});
});
