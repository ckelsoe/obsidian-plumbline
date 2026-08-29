import { scriptureSpans } from '../engine/scripture';

describe('scriptureSpans', () => {
	it('detects an inline quoted verse with a citation', () => {
		const text =
			'He said, "Truly, truly, I say to you." (John 6:47, ESV) Amen.';
		const spans = scriptureSpans(text);
		expect(spans).toHaveLength(1);
		const span = spans[0];
		expect(span).toBeDefined();
		if (span) {
			expect(span.kind).toBe('scripture');
			expect(text.slice(span.start, span.end)).toBe(
				'"Truly, truly, I say to you." (John 6:47, ESV)',
			);
		}
	});

	it('ignores a quote whose parenthetical has no chapter:verse', () => {
		expect(
			scriptureSpans('She said "hello there" (a warm greeting).'),
		).toEqual([]);
	});

	it('handles a verse-range citation', () => {
		expect(
			scriptureSpans('"For God so loved the world." (John 3:16-17, NIV)'),
		).toHaveLength(1);
	});

	it('detects curly-quoted verses', () => {
		const text = '“It is finished.” (John 19:30, ESV)';
		expect(scriptureSpans(text)).toHaveLength(1);
	});

	it('finds every verse in a passage', () => {
		const text =
			'"In the beginning." (Genesis 1:1, ESV) and "It is finished." (John 19:30, ESV)';
		expect(scriptureSpans(text)).toHaveLength(2);
	});
});
