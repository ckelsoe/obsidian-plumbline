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

// Carry the matched text's capitalisation onto its replacement.
//
// A phrase list is matched case-insensitively, so "Leverage" at the start of a
// sentence matches the lower-case entry. Substituting the raw replacement would
// hand back "use this" mid-sentence and quietly lower-case the writer's opening
// word. Only the first letter is considered: an all-caps match is shouting and
// its replacement should not inherit that.
export function matchCase(matched: string, replacement: string): string {
	const first = matched[0];
	if (first === undefined) {
		return replacement;
	}
	// True only for a character that HAS a lower-case form, which is to say an
	// upper-case letter. Comparing against toUpperCase() instead would treat a
	// quote or a digit as upper case, since those are their own upper case, and
	// capitalise the replacement for a match with no case to carry.
	const isUpperCaseLetter = first !== first.toLowerCase();
	if (!isUpperCaseLetter) {
		return replacement;
	}
	return replacement.charAt(0).toUpperCase() + replacement.slice(1);
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
			// Looked up by the phrase that actually matched, lower-cased, which
			// is how the map is keyed. A rule with replacements for some of its
			// phrases leaves the rest without a fix.
			const replacement = rule.replace?.[m[0].toLowerCase()];
			diagnostics.push({
				ruleSlug: rule.slug,
				severity: rule.severity,
				start: m.index,
				end: matcher.lastIndex,
				message: rule.message,
				packId: rule.packId,
				...(replacement === undefined
					? {}
					: { fix: matchCase(m[0], replacement) }),
			});
		}
	}
	diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
	return diagnostics;
}
