import { LintResult, Metrics, ResolvedConfig } from './types';
import { protectedSpans, maskSpans } from './protected-spans';
import { applyRules } from './apply-rules';
import {
	sentenceLengths,
	mean,
	coefficientOfVariation,
} from './sentence-stats';

// The engine entry point: text in, diagnostics out. Runs the protected-span
// pass, masks those spans, computes the rhythm metrics over the remaining prose,
// and runs the active rules. Because the rules run over masked text, code and
// quoted material never trigger a flag, and the offsets map back onto the source.
export function lint(text: string, config: ResolvedConfig): LintResult {
	const spans = protectedSpans(text, config);
	const prose = maskSpans(text, spans);
	const lengths = sentenceLengths(prose);
	const words = lengths.reduce((sum, n) => sum + n, 0);
	const metrics: Metrics = {
		sentences: lengths.length,
		words,
		meanSentenceLength: mean(lengths),
		burstiness: coefficientOfVariation(lengths),
	};
	const diagnostics = applyRules(prose, config.rules);
	return { diagnostics, metrics, spans };
}
