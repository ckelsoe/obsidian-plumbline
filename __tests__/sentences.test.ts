import { splitSentencesWithOffsets } from '../engine/sentences';

describe('splitSentencesWithOffsets', () => {
	it('tracks offsets for each sentence', () => {
		const text = 'One two. Three four five.';
		expect(splitSentencesWithOffsets(text)).toEqual([
			{ text: 'One two.', start: 0, end: 8 },
			{ text: 'Three four five.', start: 9, end: 25 },
		]);
	});

	it('keeps a trailing sentence with no terminal punctuation', () => {
		expect(
			splitSentencesWithOffsets('Done. Unfinished').map((s) => s.text),
		).toEqual(['Done.', 'Unfinished']);
	});

	it('returns nothing for whitespace only', () => {
		expect(splitSentencesWithOffsets('   \n ')).toEqual([]);
	});
});
