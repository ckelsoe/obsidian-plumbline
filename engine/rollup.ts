import {
	Diagnostic,
	Finding,
	Occurrence,
	ResolvedConfig,
	Severity,
} from './types';
import { withKeys } from './finding-key';

// Volume control, level one and level three of interop-contract section 3.
//
// A chapter routinely produces forty findings. Most of them are the same rule
// firing again and again, and a list of forty rows is a list nobody reads. This
// stage turns the raw hits into one row per rule, collapses a rule that fired
// past the threshold into a single counted row, and ranks what is left so the
// rules most worth acting on come first.
//
// It runs in the engine rather than in the panel on purpose: the CLI, the JSON
// report, the panel and the hub lane then all see the same shape and agree on one
// count of what is wrong with the chapter.

// Above this many hits of one rule in one note, the rule gets a single counted
// row. Four is a starting number, not a measured one: it is low enough that a
// phrase repeated through a chapter collapses, and high enough that two or three
// hits still read as individual things to look at. Tunable per profile.
export const DEFAULT_ROLLUP_THRESHOLD = 4;

// How much each severity contributes to priority. The gaps are wide on purpose:
// one error should outrank a handful of suggestions, because an error here means
// a verifiable defect (a misquoted verse) while a suggestion is a matter of taste.
const SEVERITY_WEIGHT: Record<Severity, number> = {
	error: 100,
	warning: 10,
	suggestion: 1,
};

// Default confidence by the kind of rule, used when a record does not set its own.
//
// The three tiers come from how the rule decides, which is what actually predicts
// how often it is right:
//
//   mechanical  a literal phrase match. If the phrase is there, the rule is
//               right about the phrase being there. What is left is whether the
//               phrase is wrong in context, which is why this is not 1.0.
//   heuristic   a cross-sentence pattern with a threshold. Real signal, but it
//               fires on shapes that are sometimes deliberate.
//   judgment    an abstraction or vagueness test. Worth surfacing, wrong often
//               enough that it should never outrank the other two at equal count.
export const CONFIDENCE = {
	mechanical: 0.9,
	heuristic: 0.6,
	judgment: 0.3,
} as const;

// Resolution order for one rule's confidence: an explicit vault-config override,
// then the rule record's own value, then the default for its kind.
export function confidenceFor(
	slug: string,
	recordValue: number | undefined,
	fallback: number,
	overrides: Record<string, number>,
): number {
	const override = Object.prototype.hasOwnProperty.call(overrides, slug)
		? overrides[slug]
		: undefined;
	const value = override ?? recordValue ?? fallback;
	// Clamped rather than trusted: overrides come from a hand-edited JSON file,
	// and a negative or huge value would invert or dominate the ranking.
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(1, Math.max(0, value));
}

export function priorityOf(
	severity: Severity,
	occurrenceCount: number,
	confidence: number,
): number {
	return SEVERITY_WEIGHT[severity] * occurrenceCount * confidence;
}

// Group the raw hits into one finding per rule, roll up past the threshold, and
// rank. `confidenceOf` is passed in rather than read from the diagnostics because
// confidence lives on the rule record, not on the hit.
export function rollup(
	text: string,
	diagnostics: readonly Diagnostic[],
	config: Pick<
		ResolvedConfig,
		'rollupThreshold' | 'confidenceBySlug' | 'rollupBySlug'
	>,
	confidenceOf: (slug: string) => number,
): Finding[] {
	const bySlug = new Map<string, Diagnostic[]>();
	for (const d of diagnostics) {
		const list = bySlug.get(d.ruleSlug);
		if (list === undefined) {
			bySlug.set(d.ruleSlug, [d]);
		} else {
			list.push(d);
		}
	}

	// A check's threshold is its own override, or the group default. A value below
	// 1 would roll up a single hit, which reads as "1 finding in this chapter"
	// where the hit itself would have been clearer, so both are floored at 1.
	const thresholdFor = (slug: string): number =>
		Math.max(
			1,
			Math.floor(config.rollupBySlug[slug] ?? config.rollupThreshold),
		);

	const findings: Finding[] = [];
	for (const [slug, hits] of bySlug) {
		const first = hits[0];
		if (first === undefined) {
			continue;
		}
		const threshold = thresholdFor(slug);
		// Keyless here; withKeys() fills them in below, once every finding for the
		// note exists. The occurrence index it hashes is note-scoped, so it cannot
		// be assigned one finding at a time.
		const occurrences: Occurrence[] = hits.map((h) => ({
			start: h.start,
			end: h.end,
			key: '',
		}));
		const confidence = confidenceOf(slug);
		findings.push({
			key: '',
			ruleSlug: slug,
			packId: first.packId,
			severity: first.severity,
			message: first.message,
			occurrences,
			confidence,
			priority: priorityOf(first.severity, hits.length, confidence),
			rolledUp: hits.length > threshold,
		});
	}

	// Ranked by priority, then by first position so the order is stable for equal
	// priorities rather than depending on Map insertion order.
	findings.sort(
		(a, b) =>
			b.priority - a.priority ||
			(a.occurrences[0]?.start ?? 0) - (b.occurrences[0]?.start ?? 0) ||
			a.ruleSlug.localeCompare(b.ruleSlug),
	);
	return withKeys(text, findings);
}
