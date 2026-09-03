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
	diagnostics: Diagnostic[];
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
}
