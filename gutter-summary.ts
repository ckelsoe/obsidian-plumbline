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
	// How many findings the paragraph carries. The bar reads this twice: as a
	// weight tier, and as a numeral once there is more than one.
	count: number;
	// Weight tier for the bar's thickness, so volume is legible without
	// hovering. Colour already carries severity, and a bar that looks identical
	// for one finding and for a hundred was answering half the question.
	weight: 1 | 2 | 3;
}

// Where the tiers sit. Chosen against the rollup threshold, which defaults to 4:
// tier 2 is "more than a couple", tier 3 is "this paragraph is the problem" and
// starts where a rule firing this often would itself have rolled up.
const DENSE = 5;
const SOME = 2;

export function weightFor(count: number): 1 | 2 | 3 {
	if (count >= DENSE) return 3;
	if (count >= SOME) return 2;
	return 1;
}

// Above this the numeral stops fitting the gutter, so it reads as "lots".
const COUNT_CEILING = 99;

// What the bar prints. Empty when there is one finding: a numeral on every
// flagged paragraph is noise, and the bar's presence already says "one".
export function countLabel(count: number): string {
	if (count < 2) return '';
	return count > COUNT_CEILING ? `${COUNT_CEILING}+` : String(count);
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
			count: 0,
			weight: 1,
		};
	}
	return {
		severity: worst(severities),
		message: `${plural(severities.length, 'finding')} in this paragraph: ${parts.join(', ')}.`,
		count: severities.length,
		weight: weightFor(severities.length),
	};
}

// The run of non-blank lines around `lineNumber`, as 1-based line numbers.
//
// A CodeMirror line is not a paragraph. A soft-wrapped paragraph is one logical
// line, which is the case contract 3.2 measured, but a writer who hard wraps at
// eighty columns produces one Markdown paragraph across several lines, and
// Markdown only ends a paragraph at a BLANK line. Summarizing per line reported
// each line's findings under a tooltip reading "in this paragraph", and split
// one paragraph into separate bars while the findings panel showed it as one
// section. The two surfaces are supposed to agree on the unit.
//
// Takes an accessor rather than a document so it can be tested without
// CodeMirror, the same split the rest of this module exists for.
export function paragraphLineRange(
	lineCount: number,
	isBlank: (lineNumber: number) => boolean,
	lineNumber: number,
): { first: number; last: number } {
	let first = lineNumber;
	while (first > 1 && !isBlank(first - 1)) {
		first -= 1;
	}
	let last = lineNumber;
	while (last < lineCount && !isBlank(last + 1)) {
		last += 1;
	}
	return { first, last };
}
