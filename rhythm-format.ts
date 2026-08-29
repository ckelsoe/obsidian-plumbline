import { LintResult } from './engine/types';

// Presentation helpers for a lint result. Pure and Obsidian-free, so they are
// unit-tested; the plugin and a future CLI both render from these.

function flagLabel(count: number): string {
	return `${count} flag${count === 1 ? '' : 's'}`;
}

// Short status-bar label: the active note's rhythm, and the flag count if any.
export function rhythmStatusText(result: LintResult): string {
	if (result.metrics.sentences === 0) {
		return 'Rhythm: no prose';
	}
	const base = `Rhythm ${result.metrics.burstiness.toFixed(2)} CV`;
	if (result.diagnostics.length === 0) {
		return base;
	}
	return `${base}, ${flagLabel(result.diagnostics.length)}`;
}

// Multi-line detail for the on-demand notice.
export function rhythmDetail(result: LintResult): string {
	const { metrics, diagnostics } = result;
	if (metrics.sentences === 0) {
		return 'No prose found in this note.';
	}
	return [
		`Burstiness (CV): ${metrics.burstiness.toFixed(2)}`,
		`Sentences: ${metrics.sentences}`,
		`Words: ${metrics.words}`,
		`Mean sentence length: ${metrics.meanSentenceLength.toFixed(1)}`,
		`Flags: ${diagnostics.length}`,
	].join('\n');
}
