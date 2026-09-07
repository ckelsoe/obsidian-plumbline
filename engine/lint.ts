import { LintResult, Metrics, ResolvedConfig } from './types';
import { protectedSpans, maskSpans } from './protected-spans';
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
	const spans = protectedSpans(text, config);
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
	const diagnostics = [
		...applyRules(prose, config.rules),
		...applyHeuristics(prose, sentences, new Set(config.disabledSlugs)),
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

	const findings = rollup(diagnostics, config, confidenceOf);
	return { diagnostics, findings, metrics, spans };
}
