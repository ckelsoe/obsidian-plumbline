import { LintResult, Metrics, ResolvedConfig } from './types';
import { protectedSpans, maskSpans } from './protected-spans';
import {
	sentenceLengths,
	mean,
	coefficientOfVariation,
} from './sentence-stats';

// The engine entry point: text in, diagnostics out. Runs the protected-span
// pass, masks those spans, and computes the rhythm metrics over the remaining
// prose. Rules are added in later milestones; today it reports metrics and the
// span map, and no diagnostics.
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
	return { diagnostics: [], metrics, spans };
}
