// Pure sentence-rhythm statistics with no Obsidian dependency, so the same code
// runs in the plugin, the headless CLI, and unit tests unchanged. Burstiness,
// the coefficient of variation of sentence length, is the first real check in
// the build plan and the single most useful signal for machine-shaped prose.

// A token ends a sentence when it closes with terminal punctuation, allowing
// trailing quotes or brackets ("done." or wrapped!"). Anchored and single-pass,
// so it stays linear. No lookbehind anywhere: `(?<=...)` is a parse error in
// JavaScriptCore before iOS 16.4 and would stop the plugin loading at all there.
const SENTENCE_END = /[.!?]["'”’)\]]*$/;

// Split prose into sentences by walking whitespace-separated tokens and closing
// a sentence at the first token that ends on terminal punctuation. The engine's
// protected-span pass strips quoted scripture and code before text reaches here.
export function splitSentences(text: string): string[] {
	const sentences: string[] = [];
	let current: string[] = [];
	for (const token of text.split(/\s+/)) {
		if (token.length === 0) {
			continue;
		}
		current.push(token);
		if (SENTENCE_END.test(token)) {
			sentences.push(current.join(' '));
			current = [];
		}
	}
	if (current.length > 0) {
		sentences.push(current.join(' '));
	}
	return sentences;
}

// Word count of one sentence: whitespace-separated runs.
export function wordCount(sentence: string): number {
	return sentence
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0).length;
}

export function sentenceLengths(text: string): number[] {
	return splitSentences(text).map(wordCount);
}

export function mean(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((sum, n) => sum + n, 0) / values.length;
}

// Population standard deviation.
export function standardDeviation(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const avg = mean(values);
	const variance =
		values.reduce((sum, n) => sum + (n - avg) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

// Coefficient of variation of sentence length: standard deviation over mean.
// This is "burstiness". Human prose runs high (roughly 0.6 to 1.2); machine
// prose clusters low (roughly 0.2 to 0.4). The bands are calibrated per profile
// against the writer's own hand-written baseline, never hardcoded as a verdict.
export function burstiness(text: string): number {
	const lengths = sentenceLengths(text);
	const avg = mean(lengths);
	if (avg === 0) {
		return 0;
	}
	return standardDeviation(lengths) / avg;
}
