import { Diagnostic } from './engine/types';

// Turning a finding into the comment Annoteca will write, per interop-contract
// section 7. Pure, so the body wording and the identity are tested rather than
// eyeballed once in a screenshot.

// Contract section 8 names a `prose-check` category for promoted findings.
// Annoteca ships no such category (its set is tone, clarify, cut, expand,
// tighten, source-needed, verse-needed, uncategorized), so this uses the nearest
// real one rather than inventing a category that would render as uncategorized
// in the user's vault. The gap is recorded in the rollout plan.
export const PROMOTE_CATEGORY = 'clarify';

// The author and source tag Annoteca writes: `[author=plumbline]` and
// `[source=plumbline:<key>]`.
export const PROMOTE_AUTHOR = 'plumbline';

export interface PromoteRequest {
	category: string;
	body: string;
	anchor: { start: number; end: number };
	author: string;
	sourceKey: string;
}

// The comment body.
//
// The writer's own words come FIRST and alone on their line, because that is
// what a reader, human or assistant, is meant to answer. The finding follows as
// context, so a thread read in the hub or an export still says what triggered
// it and which rule to switch off if the rule is the thing that is wrong.
//
// With no words from the writer the body is the finding alone, which is the
// old behaviour and still useful as a bookmark.
export function promoteBody(
	diagnostic: Diagnostic,
	anchorText: string,
	note: string,
): string {
	const finding = `Plumbline flagged "${anchorText}" (${diagnostic.ruleSlug}): ${diagnostic.message}`;
	const written = note.trim();
	return written === '' ? finding : `${written}\n\n${finding}`;
}

// The request for one finding.
//
// Returns null when the diagnostic has no key. Promotion is idempotent on the
// source key, so a comment written without one could be created again on the
// next pass and the note would collect duplicates. Refusing is the safe answer.
export function promoteRequestFor(
	diagnostic: Diagnostic,
	anchorText: string,
	note: string,
): PromoteRequest | null {
	const { key } = diagnostic;
	if (key === undefined || key === '') {
		return null;
	}
	return {
		category: PROMOTE_CATEGORY,
		body: promoteBody(diagnostic, anchorText, note),
		anchor: { start: diagnostic.start, end: diagnostic.end },
		author: PROMOTE_AUTHOR,
		sourceKey: key,
	};
}
