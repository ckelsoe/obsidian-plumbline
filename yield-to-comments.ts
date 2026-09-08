import { Diagnostic } from './engine/types';

// The yield, interop-contract 5.1.
//
// Annoteca and Plumbline both mark prose. When a human has already opened a
// comment on a passage, a second machine signal underneath it is noise: someone
// is working that sentence and does not need a linter repeating itself. So the
// squiggle steps aside there, and only there.
//
// Pure, so the rule is tested rather than eyeballed in a screenshot. The editor
// module supplies the anchors and the setting.

export type InlineUnderlines = 'always' | 'auto' | 'never';

export const DEFAULT_INLINE_UNDERLINES: InlineUnderlines = 'auto';

export function isInlineUnderlines(value: unknown): value is InlineUnderlines {
	return value === 'always' || value === 'auto' || value === 'never';
}

// One Annoteca anchor, narrowed to what the yield actually reads.
export interface CommentAnchor {
	start: number;
	end: number;
	resolved: boolean;
	// A proposed edit is in the note awaiting accept, revise or reject.
	// OPTIONAL because it arrived after Annoteca's apiVersion 2 as an additive
	// field: an older build returns anchors without it, and the yield has to
	// keep working rather than treating every anchor as addressed.
	addressed?: boolean;
}

// Whether a comment is one the writer is still working.
//
// Resolved means dealt with, so the passage is finished and a linter may speak
// again. ADDRESSED also does not suppress, which is the part worth stating: an
// addressed comment is still unresolved, but a proposed edit is sitting in the
// note waiting on the writer, so that prose is back in play and worth checking.
// Contract 5.1 spells out both.
//
// A build that predates the `addressed` field reports undefined, which reads as
// not addressed. That is the conservative direction: it suppresses on a comment
// this build cannot classify, rather than drawing over one.
export function isOpenComment(anchor: CommentAnchor): boolean {
	return !anchor.resolved && anchor.addressed !== true;
}

// The diagnostics that still get an underline.
//
// `always` is the behaviour before this setting existed, kept so nothing is
// taken away. `never` leaves the gutter and the panel, which still carry every
// finding. `auto` yields, and with no anchors to yield to it is `always`, which
// is what an unpaired vault gets for free.
export function visibleUnderlines(
	diagnostics: readonly Diagnostic[],
	anchors: readonly CommentAnchor[],
	mode: InlineUnderlines,
): Diagnostic[] {
	if (mode === 'never') return [];
	if (mode === 'always') return [...diagnostics];
	const open = anchors.filter(isOpenComment);
	if (open.length === 0) return [...diagnostics];
	// Overlap, not containment. A finding half under a comment is still a
	// finding the reader would see drawn across that comment's anchor, which is
	// the collision this exists to stop. Half-open on both sides, so ranges that
	// merely touch do not count.
	return diagnostics.filter(
		(d) => !open.some((a) => a.start < d.end && a.end > d.start),
	);
}
