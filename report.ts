import { LintResult, Severity } from './engine/types';
import { scriptureReferences } from './engine/scripture';
import { lineOf } from './engine/sentences';
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

// Bumped whenever the shape below changes, so a headless consumer can tell a
// report it understands from one it does not. Stamped from the first version
// that carried it rather than added later: a shape change with no version on it
// is indistinguishable from the old shape to anything reading these files.
//
//   1  file, profile, metrics, scripture, findings[] (one entry per hit)
//   2  findings[] become one entry per RULE, carrying every occurrence, a
//      confidence and a priority, ranked. `hits` holds the old per-hit list.
//   3  every finding and every occurrence carries a stable `key`
//      (interop-contract 7.2), so a consumer can tell the finding it already
//      acted on from a new one without comparing offsets that move on any edit.
export const REPORT_SCHEMA_VERSION = 3;

// One rule's findings for this note: every place it fired, plus what the ranking
// thought of it. This is the rolled-up shape the panel and the hub lane read, so
// a collaborator on the filesystem sees the same counts the writer sees.
export interface ReportRuleFinding {
	// Contract 7.2. This finding's identity, which is its first occurrence's.
	key: string;
	ruleSlug: string;
	packId: string;
	severity: Severity;
	message: string;
	confidence: number;
	priority: number;
	rolledUp: boolean;
	occurrences: {
		// Contract 7.2. What a promoted comment carries as its source key, so a
		// re-lint can tell which occurrences already have a thread.
		key: string;
		line: number;
		start: number;
		end: number;
		text: string;
	}[];
}

export interface Report {
	schemaVersion: number;
	file: string;
	profile: string;
	metrics: LintResult['metrics'];
	scripture: ScriptureUsage;
	// Ranked, one per rule. Read this first.
	findings: ReportRuleFinding[];
	// Every hit at its own position, unranked, in document order. Kept because it
	// is what a positional consumer needs and what the parity oracle diffs
	// against; the rolled-up view above cannot be un-rolled back into it.
	hits: ReportFinding[];
}

export function buildReport(
	file: string,
	profile: string,
	text: string,
	result: LintResult,
): Report {
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		file,
		profile,
		metrics: result.metrics,
		scripture: summarizeScripture(scriptureReferences(text)),
		findings: result.findings.map((f) => ({
			key: f.key,
			ruleSlug: f.ruleSlug,
			packId: f.packId,
			severity: f.severity,
			message: f.message,
			confidence: f.confidence,
			priority: f.priority,
			rolledUp: f.rolledUp,
			occurrences: f.occurrences.map((o) => ({
				key: o.key,
				line: lineOf(text, o.start),
				start: o.start,
				end: o.end,
				text: text.slice(o.start, o.end),
			})),
		})),
		hits: result.diagnostics.map((d) => ({
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
