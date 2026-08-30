import {
	splitSentencesWithOffsets,
	splitParagraphsWithOffsets,
} from '../engine/sentences';

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

describe('splitParagraphsWithOffsets', () => {
	it('splits on blank lines with tight offsets', () => {
		const text = 'First para.\n\nSecond para here.';
		const paragraphs = splitParagraphsWithOffsets(text);
		expect(paragraphs.map((p) => p.text)).toEqual([
			'First para.',
			'Second para here.',
		]);
		const second = paragraphs[1];
		expect(second).toBeDefined();
		if (second) {
			expect(text.slice(second.start, second.end)).toBe(
				'Second para here.',
			);
		}
	});
});
