import { rhythmStatusText, rhythmDetail } from '../rhythm-format';
import { Metrics } from '../engine/types';

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
	it('shows the burstiness for prose', () => {
		expect(rhythmStatusText(sample)).toBe('Rhythm 0.83 CV');
	});

	it('reports no prose when there are no sentences', () => {
		expect(rhythmStatusText(empty)).toBe('Rhythm: no prose');
	});
});

describe('rhythmDetail', () => {
	it('lists the metrics', () => {
		expect(rhythmDetail(sample)).toBe(
			[
				'Burstiness (CV): 0.83',
				'Sentences: 12',
				'Words: 200',
				'Mean sentence length: 16.7',
			].join('\n'),
		);
	});

	it('reports no prose for empty metrics', () => {
		expect(rhythmDetail(empty)).toBe('No prose found in this note.');
	});
});
