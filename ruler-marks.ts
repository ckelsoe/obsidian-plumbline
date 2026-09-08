import { Diagnostic, Severity } from './engine/types';

// The marks drawn beside the scrollbar: where the trouble is in a whole draft,
// without scrolling through it.
//
// Kept out of editor-decorations.ts so it can be tested, the same split
// gutter-summary.ts and panel-model.ts use.

// Vertical resolution of the strip, in buckets. A chapter can carry hundreds of
// findings and a mark per finding would be hundreds of DOM nodes stacked into an
// unreadable smear. Bucketing keeps the node count bounded and the map legible,
// and 200 is finer than any editor is tall in CSS pixels for a single mark.
const BUCKETS = 200;

export interface RulerMark {
	// 0..1 down the document, for `top: <fraction * 100>%`.
	position: number;
	// The worst severity in this bucket, which is what colours the mark.
	severity: Severity;
	// How many findings the bucket holds, for the mark's title.
	count: number;
	// Document offset to scroll to when the mark is clicked: the first finding
	// in the bucket, so the jump lands on something rather than near it.
	offset: number;
}

const RANK: Record<Severity, number> = { suggestion: 0, warning: 1, error: 2 };

function worse(a: Severity, b: Severity): Severity {
	return RANK[a] >= RANK[b] ? a : b;
}

// One mark per occupied bucket, in document order.
//
// `docLength` of zero is guarded: an empty document has no findings, but the
// division would be by zero and a NaN `top` silently drops the mark to the
// browser's default position rather than failing.
export function rulerMarks(
	diagnostics: readonly Diagnostic[],
	docLength: number,
): RulerMark[] {
	if (docLength <= 0) {
		return [];
	}
	const buckets = new Map<number, RulerMark>();
	for (const d of diagnostics) {
		// Clamped, because a diagnostic sitting at the very end of the document
		// would otherwise land in bucket BUCKETS, one past the strip.
		const index = Math.min(
			BUCKETS - 1,
			Math.max(0, Math.floor((d.start / docLength) * BUCKETS)),
		);
		const existing = buckets.get(index);
		if (existing === undefined) {
			buckets.set(index, {
				position: index / BUCKETS,
				severity: d.severity,
				count: 1,
				offset: d.start,
			});
		} else {
			existing.severity = worse(existing.severity, d.severity);
			existing.count += 1;
			existing.offset = Math.min(existing.offset, d.start);
		}
	}
	return [...buckets.values()].sort((a, b) => a.position - b.position);
}

// The mark's tooltip. Says how many and how bad, because the mark itself is a
// few pixels tall and can only carry a colour.
export function rulerMarkTitle(mark: RulerMark): string {
	const noun = mark.count === 1 ? 'finding' : 'findings';
	return `${mark.count} ${noun} here, worst is ${mark.severity}. Click to jump.`;
}
