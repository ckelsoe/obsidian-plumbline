// The engine's public data contract. Kept free of any Obsidian import so the
// same engine runs in the plugin, the headless CLI, and unit tests. Character
// offsets are UTF-16 units, matching both CodeMirror positions and JS string
// indices, so the plugin can map a diagnostic straight onto the editor.

export type Severity = 'error' | 'warning' | 'suggestion';

// A run of text that every rule skips: quoted scripture, code, headings,
// frontmatter, and comments. Produced by the protected-span pass before any rule
// runs.
export interface Span {
	start: number; // inclusive UTF-16 offset
	end: number; // exclusive UTF-16 offset
	kind: string; // 'frontmatter' | 'code' | 'heading' | 'annoteca-comment' | 'html-comment' | (pack-contributed)
}

// One finding. `start`/`end` locate it in the source; `packId` and `ruleSlug`
// say which rule fired so the report can name it and a profile can tune it.
export interface Diagnostic {
	ruleSlug: string;
	severity: Severity;
	start: number;
	end: number;
	message: string;
	packId: string;
	// Stable identity for this hit, interop-contract 7.2. Optional on the type
	// because a hand-built test fixture has no reason to invent one; lint() fills
	// it on every diagnostic it returns, so anything reading a real result has it.
	key?: string;
	// What this hit can be replaced with, when the rule names a replacement for
	// the exact phrase that matched. Absent means there is no single right word
	// and the decision is the writer's.
	fix?: string;
	// Several labelled suggestions, from reference-driven rules (term lists).
	// When two references disagree about one term, every suggestion is offered,
	// each naming its reference, and the writer picks: nothing is resolved
	// silently. Present instead of `fix`, never alongside it.
	fixOptions?: FixOption[];
}

// One suggested replacement and the reference it came from.
export interface FixOption {
	text: string;
	source: string;
}

// A rule as data, not code. A mechanical rule flags any of its `phrases`, matched
// case-insensitively at word boundaries, outside the protected spans. Its slug is
// the stable config key (never the ruleset number); severity is the default a
// profile can override. See config-model.md.
export interface Rule {
	slug: string;
	packId: string;
	category: string; // A-H, from detection-ruleset.md
	severity: Severity;
	message: string;
	phrases: string[];
	// Plain-word replacements, keyed by the phrase as written in `phrases`.
	//
	// Deliberately PER PHRASE and optional. "leverage" has one plain equivalent
	// and "intricate" does not, so a rule carries fixes for the phrases that have
	// a right answer and stays silent on the rest. Offering a wrong word is worse
	// than offering none: the writer would have to undo it and lose their own.
	replace?: Record<string, string>;
	// Labelled suggestions per phrase, for reference-driven rules; keyed like
	// `replace` (lower-cased, or as written when caseSensitive).
	fixOptions?: Record<string, FixOption[]>;
	// Match the phrases exactly as written. For a product name whose wrong form
	// differs only in case ("PlumbLine" for "Plumbline"), a case-insensitive
	// match would flag the correct spelling too.
	caseSensitive?: boolean;
	// How often this rule is right when it fires, 0..1. Ranking multiplies by it,
	// so a rule that is usually correct outranks a noisy one with the same
	// severity and count. Omitted means the default for the rule's kind, which is
	// what almost every record should do: see CONFIDENCE in rollup.ts, where the
	// three tiers and their reasoning live.
	confidence?: number;
}

// One place a rule fired. A finding carries every one of them, so a rolled-up
// finding can still point at each hit.
export interface Occurrence {
	start: number; // inclusive UTF-16 offset
	end: number; // exclusive UTF-16 offset
	// Stable identity for this one hit, interop-contract 7.2. Assigned by
	// withKeys() over the whole note, because the index it hashes is the position
	// among the same rule's hits in this note. A rolled-up finding promotes one
	// comment per occurrence, and this is the key each of those carries.
	key: string;
}

// What the panel, the report and (from PL-E) the API show: one row per rule per
// note rather than one per hit, ranked so the rules most worth reading come first.
//
// This is NOT what the editor underlines. Those need every hit at its own
// position, which is `LintResult.diagnostics`. Keeping both is deliberate: rollup
// is a separate stage over the raw findings, so the raw ones stay available for
// the underline layer and for the parity check against prose-check-prototype.py,
// which would otherwise have to learn to roll up too.
export interface Finding {
	// This finding's identity for the hub lane: its FIRST occurrence's key.
	// Promotion does not match on it, because a rolled-up finding creates one
	// comment per occurrence, each carrying that occurrence's own key.
	key: string;
	ruleSlug: string;
	packId: string;
	severity: Severity;
	message: string;
	occurrences: Occurrence[];
	confidence: number;
	// severityWeight x occurrenceCount x confidence. Findings come back sorted by
	// it, descending.
	priority: number;
	// True when this stands in for more hits than the threshold allows as separate
	// rows. `occurrences.length` still holds every one of them.
	rolledUp: boolean;
}

// Per-document statistics, so the panel and the report show the rhythm summary
// without re-deriving it. Burstiness is the coefficient of variation of
// sentence length (see config-model.md).
export interface Metrics {
	sentences: number;
	words: number;
	meanSentenceLength: number;
	burstiness: number;
}

export interface LintResult {
	// Every hit at its own position, unrolled and unranked, sorted by position.
	// The editor underlines and the parity oracle read this.
	diagnostics: Diagnostic[];
	// The same hits grouped per rule, rolled up past the threshold and ranked by
	// priority. The panel, the report and the API read this.
	findings: Finding[];
	metrics: Metrics;
	spans: Span[];
}

// The fully cascaded config for one document. A resolver produces this and hands
// it to the engine; the engine never resolves config itself. It carries the
// active profile id, which base span sources are on, and the active rules. The
// full pack and profile cascade (config-model.md) fills this in over time.
export interface ResolvedConfig {
	profileId: string;
	protectedSpanKinds: string[];
	rules: Rule[];
	// Slugs the user disabled. Mechanical rules are already dropped from `rules`;
	// the heuristics run separately and consult this set so they can be toggled too.
	disabledSlugs: string[];
	// Above this many hits of ONE rule in one note, the findings list carries a
	// single rolled-up row instead of one row per hit. Per profile, because a
	// technical profile and a devotional one disagree about what reads as noise.
	rollupThreshold: number;
	// Per-rule confidence overrides, slug to 0..1, from the vault config. A rule
	// absent here uses its record's value, or the default for its kind.
	confidenceBySlug: Record<string, number>;
	// Heuristic severity overrides, slug to Severity. A mechanical rule carries its
	// resolved severity in `rules` (a group copies the record with the new value),
	// but the cross-sentence heuristics run separately, so their per-group override
	// is resolved here and applied by the heuristic pass. See config-model.md,
	// per-membership tuning.
	severityBySlug: Record<string, Severity>;
	// Per-check roll-up overrides, slug to a threshold. A rule absent here uses
	// `rollupThreshold`; a noisy check can collapse to one row sooner. Roll-up
	// defaults on the group and a membership overrides it, the reverse of severity
	// and confidence (config-model.md).
	rollupBySlug: Record<string, number>;
}
