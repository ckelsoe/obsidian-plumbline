import { Diagnostic } from './engine/types';

// One finding paired with the row it draws on. Overlapping findings get distinct
// layers so their underlines stack instead of collapsing into one line.
export interface LayeredDiagnostic {
	diagnostic: Diagnostic;
	layer: number;
}

// Assign each finding the lowest layer that no still-open finding occupies, a
// greedy interval layering. Findings are processed left to right, longer first
// when they start together, so the widest range sits on the bottom line and the
// shorter ones stack above it. Pure, so the layering is unit-tested apart from the
// CodeMirror rendering.
export function assignLayers(diagnostics: Diagnostic[]): LayeredDiagnostic[] {
	const sorted = [...diagnostics].sort(
		(a, b) => a.start - b.start || b.end - a.end,
	);
	const layerEnd: number[] = [];
	return sorted.map((diagnostic) => {
		let layer = 0;
		while (
			layer < layerEnd.length &&
			(layerEnd[layer] ?? 0) > diagnostic.start
		) {
			layer++;
		}
		layerEnd[layer] = diagnostic.end;
		return { diagnostic, layer };
	});
}
