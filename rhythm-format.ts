import { Metrics } from './engine/types';

// Presentation helpers for the rhythm metrics. Pure and Obsidian-free, so they
// are unit-tested; the plugin and a future CLI both render from these.

// Short status-bar label for the active note's rhythm.
export function rhythmStatusText(metrics: Metrics): string {
	if (metrics.sentences === 0) {
		return 'Rhythm: no prose';
	}
	return `Rhythm ${metrics.burstiness.toFixed(2)} CV`;
}

// Multi-line detail for the on-demand notice.
export function rhythmDetail(metrics: Metrics): string {
	if (metrics.sentences === 0) {
		return 'No prose found in this note.';
	}
	return [
		`Burstiness (CV): ${metrics.burstiness.toFixed(2)}`,
		`Sentences: ${metrics.sentences}`,
		`Words: ${metrics.words}`,
		`Mean sentence length: ${metrics.meanSentenceLength.toFixed(1)}`,
	].join('\n');
}
