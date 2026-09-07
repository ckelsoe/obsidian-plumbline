import { Severity } from './engine/types';

// The one-line summary behind the gutter bar's tooltip.
//
// Kept out of editor-decorations.ts so it can be tested: that module imports
// @codemirror/view and Obsidian's DOM helpers, and this project's jest runs on
// the 'node' environment with neither available. Same split as
// underline-coverage.ts.

export interface GutterSummary {
	severity: Severity;
	message: string;
}

// Worst severity present, which is what colors the bar.
function worst(severities: readonly Severity[]): Severity {
	if (severities.includes('error')) {
		return 'error';
	}
	if (severities.includes('warning')) {
		return 'warning';
	}
	return 'suggestion';
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Why a count rather than the findings themselves: CodeMirror's gutter tooltip
// lists every diagnostic on the line, and a line here is a whole paragraph. A
// single 1197-character paragraph carrying 35 findings produced a 5516px tooltip,
// measured in the running app, which is taller than any screen.
//
// A list is also the wrong shape at any length. The gutter addresses a paragraph
// and cannot point at a phrase, so it answers the question it can answer: how much
// is wrong here, and how bad. The underline and the panel locate the phrase.
//
// Severities are listed in descending order and empty ones are omitted, so a
// paragraph with only suggestions does not read "0 errors, 0 warnings".
export function summarizeSeverities(
	severities: readonly Severity[],
): GutterSummary {
	let errors = 0;
	let warnings = 0;
	let suggestions = 0;
	for (const s of severities) {
		if (s === 'error') {
			errors += 1;
		} else if (s === 'warning') {
			warnings += 1;
		} else {
			suggestions += 1;
		}
	}
	const parts: string[] = [];
	if (errors > 0) {
		parts.push(plural(errors, 'error'));
	}
	if (warnings > 0) {
		parts.push(plural(warnings, 'warning'));
	}
	if (suggestions > 0) {
		parts.push(plural(suggestions, 'suggestion'));
	}
	// Only reachable if a caller hands over an empty list. CodeMirror does not:
	// it calls the filter from a marker that exists because diagnostics do. Guarded
	// anyway, because the composed form would otherwise read "0 findings in this
	// paragraph: ." with a dangling colon.
	if (parts.length === 0) {
		return {
			severity: 'suggestion',
			message: 'No findings in this paragraph.',
		};
	}
	return {
		severity: worst(severities),
		message: `${plural(severities.length, 'finding')} in this paragraph: ${parts.join(', ')}.`,
	};
}
