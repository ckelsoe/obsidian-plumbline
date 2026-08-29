import { LintResult, Metrics, ResolvedConfig } from './types';
import { protectedSpans, maskSpans } from './protected-spans';
import { applyRules } from './apply-rules';
import { applyHeuristics } from './heuristics';
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
		...applyHeuristics(prose, sentences),
	];
	diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
	return { diagnostics, metrics, spans };
}
