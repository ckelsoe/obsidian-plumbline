// Whether a range Plumbline wants to rewrite is text Annoteca owns.
//
// Interop-contract 4.1 makes Annoteca the only writer of note prose, because its
// reject-as-revert holds a byte-for-byte original and that is only true if one
// system performed the replacement. The one-click fix is a prose write, so it
// yields wherever Annoteca has an anchor.
//
// Pure, and split out from main.ts so the arithmetic is tested rather than
// argued about: an off-by-one here either blocks a legal edit or, worse, lets a
// rewrite land inside a comment's anchor.

export interface Range {
	start: number;
	end: number;
}

// Half-open on both sides, matching every other range in this codebase: `end` is
// exclusive. So ranges that merely TOUCH do not overlap, and a fix on the word
// immediately after an anchor is allowed rather than refused.
export function overlapsAnchor(
	anchors: readonly Range[],
	from: number,
	to: number,
): boolean {
	return anchors.some((a) => a.start < to && a.end > from);
}
