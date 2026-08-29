import { Diagnostic, Rule } from './types';

// Escape a phrase so it is matched literally inside a built regex.
function escapeRegExp(phrase: string): string {
	return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One case-insensitive, word-bounded alternation for a rule's phrases. The
// phrases are literals joined with `|`, so the pattern is linear (no nested
// quantifiers, no backtracking blowup).
function buildMatcher(phrases: string[]): RegExp {
	const alternation = phrases.map(escapeRegExp).join('|');
	return new RegExp(`\\b(?:${alternation})\\b`, 'gi');
}

// Run mechanical rules over the masked prose and return diagnostics, sorted by
// position. The text is already masked, so matches fall only in real prose and
// the offsets map straight back onto the original document.
export function applyRules(prose: string, rules: Rule[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const rule of rules) {
		if (rule.phrases.length === 0) {
			continue;
		}
		const matcher = buildMatcher(rule.phrases);
		for (let m = matcher.exec(prose); m !== null; m = matcher.exec(prose)) {
			diagnostics.push({
				ruleSlug: rule.slug,
				severity: rule.severity,
				start: m.index,
				end: matcher.lastIndex,
				message: rule.message,
				packId: rule.packId,
			});
		}
	}
	diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
	return diagnostics;
}
