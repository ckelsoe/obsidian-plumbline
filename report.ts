import { LintResult, Severity } from './engine/types';
import { scriptureReferences } from './engine/scripture';
import { summarizeScripture, ScriptureUsage } from './engine/citation';

// A JSON report of one note's findings, written into the vault so an AI
// collaborator working on the filesystem reads the same findings the writer sees
// in the editor. This is the dual-visibility path (see the project's dev docs).

export interface ReportFinding {
	ruleSlug: string;
	packId: string;
	severity: Severity;
	line: number;
	start: number;
	end: number;
	text: string;
	message: string;
}

export interface Report {
	file: string;
	profile: string;
	metrics: LintResult['metrics'];
	scripture: ScriptureUsage;
	findings: ReportFinding[];
}

// One-based line number of a character offset, counted by newlines before it.
function lineOf(text: string, offset: number): number {
	let line = 1;
	const limit = Math.min(offset, text.length);
	for (let i = 0; i < limit; i++) {
		if (text[i] === '\n') {
			line += 1;
		}
	}
	return line;
}

export function buildReport(
	file: string,
	profile: string,
	text: string,
	result: LintResult,
): Report {
	return {
		file,
		profile,
		metrics: result.metrics,
		scripture: summarizeScripture(scriptureReferences(text)),
		findings: result.diagnostics.map((d) => ({
			ruleSlug: d.ruleSlug,
			packId: d.packId,
			severity: d.severity,
			line: lineOf(text, d.start),
			start: d.start,
			end: d.end,
			text: text.slice(d.start, d.end),
			message: d.message,
		})),
	};
}
