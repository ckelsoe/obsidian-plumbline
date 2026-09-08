import {
	DEFAULT_INLINE_UNDERLINES,
	isInlineUnderlines,
	isOpenComment,
	visibleUnderlines,
	type CommentAnchor,
} from '../yield-to-comments';
import { Diagnostic } from '../engine/types';

const hit = (start: number, end: number): Diagnostic => ({
	ruleSlug: 'r',
	packId: 'base',
	severity: 'warning',
	start,
	end,
	message: 'm',
	key: `k${start}`,
});

const anchor = (
	start: number,
	end: number,
	over: Partial<CommentAnchor> = {},
): CommentAnchor => ({ start, end, resolved: false, ...over });

describe('the setting', () => {
	it('defaults to auto', () => {
		expect(DEFAULT_INLINE_UNDERLINES).toBe('auto');
	});

	it('accepts only the three modes', () => {
		for (const v of ['always', 'auto', 'never']) {
			expect(isInlineUnderlines(v)).toBe(true);
		}
		for (const v of ['sometimes', '', null, undefined, 1, {}]) {
			expect(isInlineUnderlines(v)).toBe(false);
		}
	});
});

// Contract 5.1 names both exceptions explicitly.
describe('isOpenComment', () => {
	it('is true for an untouched comment', () => {
		expect(isOpenComment(anchor(0, 5))).toBe(true);
	});

	// Resolved means dealt with, so the passage is finished.
	it('is false for a resolved comment', () => {
		expect(isOpenComment(anchor(0, 5, { resolved: true }))).toBe(false);
	});

	// An addressed comment is still UNRESOLVED, but a proposed edit is waiting
	// on the writer, so that prose is back in play and worth checking again.
	it('is false for an addressed comment even though it is unresolved', () => {
		const a = anchor(0, 5, { addressed: true });
		expect(a.resolved).toBe(false);
		expect(isOpenComment(a)).toBe(false);
	});

	// An Annoteca build predating the field reports undefined. Suppressing is
	// the conservative direction: it yields on a comment this build cannot
	// classify rather than drawing over one.
	it('treats a missing addressed flag as not addressed', () => {
		expect(isOpenComment(anchor(0, 5, { addressed: undefined }))).toBe(
			true,
		);
	});
});

describe('visibleUnderlines', () => {
	const findings = [hit(0, 5), hit(10, 15), hit(20, 25)];

	it('draws nothing on never', () => {
		expect(visibleUnderlines(findings, [], 'never')).toEqual([]);
		// Even with no comments at all, which is the point of the mode.
		expect(visibleUnderlines(findings, [anchor(0, 5)], 'never')).toEqual(
			[],
		);
	});

	it('draws everything on always, even under an open comment', () => {
		expect(visibleUnderlines(findings, [anchor(0, 5)], 'always')).toEqual(
			findings,
		);
	});

	// With Annoteca absent there are no anchors, so auto is always. An unpaired
	// vault loses nothing.
	it('draws everything on auto when there is nothing to yield to', () => {
		expect(visibleUnderlines(findings, [], 'auto')).toEqual(findings);
	});

	it('drops a finding under an open comment', () => {
		const out = visibleUnderlines(findings, [anchor(0, 5)], 'auto');
		expect(out.map((d) => d.start)).toEqual([10, 20]);
	});

	it('keeps a finding under a resolved comment', () => {
		const out = visibleUnderlines(
			findings,
			[anchor(0, 5, { resolved: true })],
			'auto',
		);
		expect(out.map((d) => d.start)).toEqual([0, 10, 20]);
	});

	it('keeps a finding under an addressed comment', () => {
		const out = visibleUnderlines(
			findings,
			[anchor(0, 5, { addressed: true })],
			'auto',
		);
		expect(out.map((d) => d.start)).toEqual([0, 10, 20]);
	});

	// Overlap, not containment: a finding half under a comment would still be
	// drawn across that comment's anchor, which is the collision this exists to
	// stop.
	it('drops a finding that only partly overlaps a comment', () => {
		const out = visibleUnderlines([hit(8, 14)], [anchor(10, 20)], 'auto');
		expect(out).toEqual([]);
	});

	// Half-open on both sides, matching every other range in this codebase, so
	// a finding starting exactly where a comment ends is still drawn.
	it('keeps a finding that only touches a comment', () => {
		expect(
			visibleUnderlines([hit(20, 25)], [anchor(10, 20)], 'auto'),
		).toHaveLength(1);
		expect(
			visibleUnderlines([hit(0, 10)], [anchor(10, 20)], 'auto'),
		).toHaveLength(1);
	});

	it('checks every anchor, not just the first', () => {
		const out = visibleUnderlines(
			findings,
			[anchor(0, 5, { resolved: true }), anchor(20, 25)],
			'auto',
		);
		expect(out.map((d) => d.start)).toEqual([0, 10]);
	});

	// A copy on EVERY mode, not just the yielding one. The caller feeds this
	// straight into a decoration builder, and handing back the state field's own
	// array invites a downstream sort or splice to mutate it.
	it('hands back a new array rather than the one it was given', () => {
		for (const mode of ['always', 'auto'] as const) {
			const out = visibleUnderlines(findings, [], mode);
			expect(out).not.toBe(findings);
			expect(out).toEqual(findings);
		}
	});
});
