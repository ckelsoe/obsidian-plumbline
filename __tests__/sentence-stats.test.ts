import {
	splitSentences,
	sentenceLengths,
	wordCount,
	mean,
	standardDeviation,
	coefficientOfVariation,
	burstiness,
} from '../engine/sentence-stats';

describe('splitSentences', () => {
	it('splits on terminal punctuation', () => {
		expect(splitSentences('One. Two! Three?')).toEqual([
			'One.',
			'Two!',
			'Three?',
		]);
	});

	it('keeps a trailing sentence with no terminal punctuation', () => {
		expect(
			splitSentences('A finished thought. And an unfinished one'),
		).toEqual(['A finished thought.', 'And an unfinished one']);
	});

	it('returns nothing for whitespace only', () => {
		expect(splitSentences('   \n  ')).toEqual([]);
	});
});

describe('wordCount and sentenceLengths', () => {
	it('counts whitespace-separated words', () => {
		expect(wordCount('one two three.')).toBe(3);
	});

	it('reports one length per sentence', () => {
		expect(sentenceLengths('One two three. Four.')).toEqual([3, 1]);
	});
});

describe('mean and standardDeviation', () => {
	it('computes the mean', () => {
		expect(mean([2, 4, 6])).toBe(4);
	});

	it('is zero for an empty list', () => {
		expect(mean([])).toBe(0);
		expect(standardDeviation([])).toBe(0);
	});

	it('computes population standard deviation', () => {
		expect(standardDeviation([2, 4, 6])).toBeCloseTo(1.632993, 5);
	});
});

describe('coefficientOfVariation', () => {
	it('is standard deviation over mean', () => {
		expect(coefficientOfVariation([2, 4, 6])).toBeCloseTo(0.408248, 5);
	});

	it('is zero for an empty or all-zero set', () => {
		expect(coefficientOfVariation([])).toBe(0);
		expect(coefficientOfVariation([0, 0, 0])).toBe(0);
	});
});

describe('burstiness', () => {
	it('is zero when every sentence is the same length', () => {
		expect(
			burstiness('one two three. four five six. seven eight nine.'),
		).toBe(0);
	});

	it('rises as sentence lengths vary', () => {
		const uniform = 'aa bb cc. dd ee ff. gg hh ii.';
		const varied =
			'Short. A much longer sentence carrying several more words than that.';
		expect(burstiness(varied)).toBeGreaterThan(burstiness(uniform));
	});

	it('is zero for empty input', () => {
		expect(burstiness('')).toBe(0);
	});
});
