// Stable identity for a finding, per interop-contract 7.2.
//
// The key answers one question across a repo boundary: is this the same finding
// Annoteca already has a comment for? It has to survive a re-lint of unchanged
// prose and has to change when the prose changes, because edited prose is a new
// finding and the old thread is the record of what was there before.

import { Diagnostic, Finding, Occurrence } from './types';

// Eight hex characters, matching the `[source=plumbline:a1b2c3d4]` line in
// contract 7.1. Thirty-two bits is plenty here: keys only have to be distinct
// within one note, which holds hundreds of occurrences rather than millions, and
// a collision costs one skipped promotion rather than a wrong write.
const KEY_LENGTH = 8;

// FNV-1a, 32-bit. Chosen because it needs no dependency and is fully specified
// in a few lines, so the key a headless consumer recomputes cannot drift from
// the one the plugin wrote. Not a cryptographic hash and not used as one.
function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// The FNV prime, 16777619, applied as shifts. A plain `hash * 16777619`
		// exceeds 2^53 and silently loses low bits, so the key would depend on
		// floating-point rounding rather than on the input.
		hash =
			(hash +
				((hash << 1) +
					(hash << 4) +
					(hash << 7) +
					(hash << 8) +
					(hash << 24))) >>>
			0;
	}
	return hash >>> 0;
}

// The anchor text, reduced to what a re-lint should treat as unchanged.
//
// Case and whitespace are normalized because neither changes what the rule
// found: rewrapping a paragraph or switching line endings must not orphan a
// comment thread. Everything else, punctuation included, is left alone, because
// changing it IS an edit to the prose.
export function normalizeAnchor(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// `index` disambiguates occurrences that are otherwise identical: the position
// among the hits of the same rule carrying the SAME anchor text, in document
// order. Without it two identical phrases flagged by one rule would share a key,
// and promoting both would silently create one comment.
//
// Counted per anchor text rather than across all of the rule's hits, which is
// what makes the key survive an edit. Numbering across every hit meant deleting
// one occurrence renumbered every later one, so fixing the first of twelve
// flagged phrases changed the key of the other eleven and a consumer would have
// seen eleven brand-new findings where it already had threads. That is exactly
// the duplicate-thread case the idempotence rule in contract 7.2 exists to
// prevent.
// The hash as eight hex characters. Exported because the report index names its
// files with it too, and two hash implementations in one plugin is two things
// that can disagree about the same input.
export function shortHash(input: string): string {
	return fnv1a(input).toString(16).padStart(KEY_LENGTH, '0');
}

export function occurrenceKey(
	ruleSlug: string,
	anchorText: string,
	index: number,
): string {
	// A space separates the fields. A rule slug cannot contain one and the
	// normalized anchor cannot end with one, so no two different field triples
	// can run together into the same input string.
	const input = `${ruleSlug} ${normalizeAnchor(anchorText)} ${index}`;
	return shortHash(input);
}

// The shared counter behind both key assignments below.
//
// Note-scoped, because the occurrence index is: a hit cannot number itself
// without knowing what else the same rule matched with the same words. Returns
// one key per input, in the order given.
function assignKeys(
	text: string,
	items: readonly { ruleSlug: string; start: number; end: number }[],
): string[] {
	// Document order, so the index never depends on the order rules ran in.
	const order = items
		.map((item, at) => ({ item, at }))
		.sort(
			(a, b) =>
				a.item.start - b.item.start ||
				a.item.end - b.item.end ||
				a.at - b.at,
		);
	// Counted per rule AND per anchor text, so only occurrences that are
	// genuinely indistinguishable share a counter.
	const seen = new Map<string, number>();
	const keys = new Array<string>(items.length).fill('');
	for (const { item, at } of order) {
		const anchor = text.slice(item.start, item.end);
		const bucket = `${item.ruleSlug} ${normalizeAnchor(anchor)}`;
		const index = seen.get(bucket) ?? 0;
		seen.set(bucket, index + 1);
		keys[at] = occurrenceKey(item.ruleSlug, anchor, index);
	}
	return keys;
}

// Keys for the raw diagnostics. The editor's hover works in diagnostics rather
// than findings, and a comment promoted from the hover has to carry the same key
// the report and the API would give that finding.
export function withDiagnosticKeys(
	text: string,
	diagnostics: readonly Diagnostic[],
): Diagnostic[] {
	const keys = assignKeys(text, diagnostics);
	return diagnostics.map((d, i) => ({ ...d, key: keys[i] ?? '' }));
}

// Attach keys to every occurrence of every finding, and to the findings
// themselves.
//
// Runs over the whole note at once because the occurrence index is note-scoped:
// a finding cannot number its own occurrences without knowing what else the same
// rule matched, and a rolled-up finding already holds every hit for its rule.
//
// A finding's own key is its FIRST occurrence's. It identifies the group for the
// hub lane. It is not what promotion matches on: a rolled-up finding promotes
// per occurrence (contract 3.4 says the confirmation shows the number of
// comments it will create), so each comment carries its own occurrence's key.
export function withKeys(
	text: string,
	findings: readonly Finding[],
): Finding[] {
	return findings.map((finding) => {
		// Document order, so the index does not depend on how the hits were
		// collected. rollup() already emits them in order; this does not rely on
		// that staying true.
		const ordered = [...finding.occurrences].sort(
			(a, b) => a.start - b.start || a.end - b.end,
		);
		// Counted per anchor text, so only occurrences that are genuinely
		// indistinguishable share a counter. Two hits with different text never
		// renumber each other, whatever happens between them.
		// Through the same counter the diagnostics use, so a finding's key and
		// the key on the diagnostic it came from cannot drift apart.
		const keys = assignKeys(
			text,
			ordered.map((o) => ({ ...o, ruleSlug: finding.ruleSlug })),
		);
		const keyOf = new Map<Occurrence, string>();
		ordered.forEach((occurrence, i) => {
			keyOf.set(occurrence, keys[i] ?? '');
		});
		const occurrences = finding.occurrences.map((occurrence) => ({
			...occurrence,
			key: keyOf.get(occurrence) ?? '',
		}));
		return {
			...finding,
			occurrences,
			key: occurrences[0]?.key ?? '',
		};
	});
}
