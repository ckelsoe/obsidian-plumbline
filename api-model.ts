import { Finding, Severity } from './engine/types';

// The Obsidian-free half of the API: the shape that crosses the repo boundary,
// and the subscriber bookkeeping behind onFindingsChanged.
//
// Split out for the same reason gutter-summary.ts and panel-model.ts are: api.ts
// imports Obsidian, and this project's jest runs on the 'node' environment.

// Checked by the consumer before any call. An integer, and unknown or higher
// means degrade to unpaired behaviour rather than guess (contract 7).
export const PLUMBLINE_API_VERSION = 1;

export interface ApiOccurrence {
	start: number;
	end: number;
	// Stable identity for this hit, contract 7.2. A rolled-up finding promotes
	// one comment per occurrence, and this is the key each one carries.
	key: string;
}

// Deliberately not the engine's `Finding`: that type is free to grow fields for
// the panel and the report without those becoming things this API can never
// change.
export interface ApiFinding {
	key: string;
	ruleSlug: string;
	packId: string;
	severity: Severity;
	message: string;
	occurrences: readonly ApiOccurrence[];
	confidence: number;
	// severityWeight x occurrenceCount x confidence, contract 3.3. Exposed rather
	// than left for the consumer to recompute: the severity weights would have to
	// be duplicated across the boundary, and two copies of a ranking formula is
	// two rankings the moment one is tuned.
	priority: number;
	// The rule fired more times than the profile's rollup threshold. Not the same
	// as `occurrences.length > 1`: every finding carries all of its hits, and the
	// threshold decides whether that counts as a density problem worth saying so.
	rolledUp: boolean;
}

export interface PlumblineApi {
	readonly apiVersion: number;
	findingsFor(path: string): Promise<readonly ApiFinding[]>;
	onFindingsChanged(cb: (path: string) => void): () => void;
	activeProfile(path: string): string;
}

// A copy, never a view onto the engine's object. A consumer that mutated what it
// was handed would otherwise be editing the next render's data.
export function toApiFinding(finding: Finding): ApiFinding {
	return {
		key: finding.key,
		ruleSlug: finding.ruleSlug,
		packId: finding.packId,
		severity: finding.severity,
		message: finding.message,
		occurrences: finding.occurrences.map((o) => ({
			start: o.start,
			end: o.end,
			key: o.key,
		})),
		confidence: finding.confidence,
		priority: finding.priority,
		rolledUp: finding.rolledUp,
	};
}

export class FindingsListeners {
	private readonly listeners = new Set<(path: string) => void>();

	add(cb: (path: string) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	get size(): number {
		return this.listeners.size;
	}

	emit(path: string): void {
		// Iterated over a copy, so a consumer that unsubscribes from inside its
		// own callback does not change the set being walked.
		for (const cb of [...this.listeners]) {
			try {
				cb(path);
			} catch (err) {
				// One consumer throwing must not stop the others from being told,
				// and must not take down the edit that triggered this.
				console.error(err);
			}
		}
	}
}
