import { LintResult, Metrics, ResolvedConfig } from './types';
import { protectedSpans, maskSpans, SKIP_KIND } from './protected-spans';
import { fileScope } from './file-scope';
import { applyRules } from './apply-rules';
import { applyHeuristics, heuristicConfidence } from './heuristics';
import { CONFIDENCE, confidenceFor, rollup } from './rollup';
import { splitSentencesWithOffsets } from './sentences';
import { wordCount, mean, coefficientOfVariation } from './sentence-stats';

// The engine entry point: text in, diagnostics out. Runs the protected-span
// pass, masks those spans, computes the rhythm metrics over the remaining prose,
// and runs both the mechanical rules and the cross-sentence heuristics. Because
// everything runs over masked text, code and quoted material never trigger a
// flag, and the offsets map back onto the source.
export function lint(text: string, config: ResolvedConfig): LintResult {
	// Per-file scoping runs FIRST and inside lint, so the editor, the CLI and the
	// JSON report scope identically. A note opted out in one surface and linted
	// in another would be worse than no scoping at all.
	const scope = fileScope(text);

	const spans = protectedSpans(text, config);
	// Skipped regions join the protected spans rather than filtering diagnostics
	// afterwards. Masking is what the rules already respect, so a region is
	// invisible to every rule AND to the rhythm metrics, which is what "skip this
	// stretch" has to mean: a burstiness number computed over prose the writer
	// excluded is a wrong number, not a filtered one.
	for (const range of scope.skipRanges) {
		spans.push({ start: range.start, end: range.end, kind: SKIP_KIND });
	}
	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	const prose = maskSpans(text, spans);
	const sentences = splitSentencesWithOffsets(prose);
	const lengths = sentences.map((sentence) => wordCount(sentence.text));
	const words = lengths.reduce((sum, n) => sum + n, 0);
	const metrics: Metrics = {
		sentences: lengths.length,
		words,
		meanSentenceLength: mean(lengths),
		burstiness: coefficientOfVariation(lengths),
	};
	// The note's own disabled slugs sit on top of the vault config's.
	const disabled = new Set([...config.disabledSlugs, ...scope.disabledSlugs]);
	const rules = config.rules.filter((r) => !disabled.has(r.slug));
	const diagnostics = scope.disableAll
		? []
		: [
				...applyRules(prose, rules),
				...applyHeuristics(prose, sentences, disabled),
			];
	diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);

	// Confidence lives on the rule record, not on the hit, so it is resolved here
	// where both rule sets are in scope. A mechanical rule is one the config
	// carries; anything else came from the heuristics.
	const mechanical = new Map(config.rules.map((r) => [r.slug, r]));
	const confidenceOf = (slug: string): number => {
		const rule = mechanical.get(slug);
		if (rule !== undefined) {
			return confidenceFor(
				slug,
				rule.confidence,
				CONFIDENCE.mechanical,
				config.confidenceBySlug,
			);
		}
		return confidenceFor(
			slug,
			heuristicConfidence(slug),
			CONFIDENCE.heuristic,
			config.confidenceBySlug,
		);
	};

	const findings = rollup(text, diagnostics, config, confidenceOf);
	return { diagnostics, findings, metrics, spans };
}
