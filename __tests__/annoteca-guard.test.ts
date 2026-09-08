import { overlapsAnchor } from '../annoteca-guard';

const anchors = [
	{ start: 10, end: 20 },
	{ start: 40, end: 50 },
];

describe('overlapsAnchor', () => {
	it('is false when there are no anchors', () => {
		expect(overlapsAnchor([], 10, 20)).toBe(false);
	});

	it('is false for a range entirely before or after every anchor', () => {
		expect(overlapsAnchor(anchors, 0, 5)).toBe(false);
		expect(overlapsAnchor(anchors, 25, 35)).toBe(false);
		expect(overlapsAnchor(anchors, 60, 70)).toBe(false);
	});

	// `end` is exclusive everywhere in this codebase, so touching is not
	// overlapping. Getting this wrong refuses a fix on the word immediately
	// after a comment's anchor, which is a legal edit.
	it('is false for ranges that only touch an anchor', () => {
		expect(overlapsAnchor(anchors, 0, 10)).toBe(false);
		expect(overlapsAnchor(anchors, 20, 30)).toBe(false);
	});

	it('is true for a range inside an anchor', () => {
		expect(overlapsAnchor(anchors, 12, 18)).toBe(true);
	});

	it('is true for a range that swallows an anchor', () => {
		expect(overlapsAnchor(anchors, 5, 25)).toBe(true);
	});

	it('is true for a range overlapping either end of an anchor', () => {
		expect(overlapsAnchor(anchors, 5, 15)).toBe(true);
		expect(overlapsAnchor(anchors, 15, 25)).toBe(true);
	});

	it('checks every anchor, not just the first', () => {
		expect(overlapsAnchor(anchors, 45, 48)).toBe(true);
	});

	// A single character replacement is the narrowest real case.
	it('is true for a one-character range inside an anchor', () => {
		expect(overlapsAnchor(anchors, 15, 16)).toBe(true);
	});
});
