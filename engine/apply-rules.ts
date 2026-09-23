import { Diagnostic, FixOption, Rule } from './types';
import { PLACEHOLDER } from './term-list';

// Escape a phrase so it is matched literally inside a built regex.
function escapeRegExp(phrase: string): string {
	return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A word boundary goes only on a side of a phrase that ends in a word
// character. A boundary beside punctuation would demand a letter next to it, so
// a phrase like "Period." could never match at the end of a sentence.
function bounded(phrase: string): string {
	// A term-list phrase may hold a one-word placeholder ([X]); every other
	// character is matched literally. Built-in phrases never contain one.
	const escaped = phrase.split(PLACEHOLDER).map(escapeRegExp).join('\\S+');
	const start = /^\w/.test(phrase) ? '\\b' : '';
	const end = /\w$/.test(phrase) ? '\\b' : '';
	return `${start}${escaped}${end}`;
}

// One word-bounded alternation for a rule's phrases, case-insensitive unless the
// rule says otherwise. The phrases are literals joined with `|`, so the pattern
// is linear (no nested quantifiers, no backtracking blowup).
function buildMatcher(phrases: string[], caseSensitive = false): RegExp {
	const alternation = phrases.map(bounded).join('|');
	return new RegExp(`(?:${alternation})`, caseSensitive ? 'g' : 'gi');
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

// Letters and digits in any script. JavaScript's \\b only knows ASCII, so on its
// own it would let "clair" match inside "éclair" (é reads as a non-word
// character) and give a term that starts or ends with an accented letter no
// boundary at all. A lookbehind would say this in the pattern, but lookbehind
// does not parse on older iOS, so matches are checked here instead.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && char.length > 0 && WORD_CHAR.test(char);
}

// A match is a whole word or phrase only if a word character at either edge
// is not glued to another word character outside it.
function atWordEdges(prose: string, start: number, end: number): boolean {
	const first = prose.charAt(start);
	const last = prose.charAt(end - 1);
	if (isWordChar(first) && isWordChar(prose.charAt(start - 1))) {
		return false;
	}
	return !(isWordChar(last) && isWordChar(prose.charAt(end)));
}

// Which fix options apply to a match. Looked up by the matched text first. A
// term with a [X] placeholder matches expanded text ("the real problem is")
// that is not a key, so it falls back to the placeholder phrase that matches.
function optionsFor(
	rule: Rule,
	key: string,
	matched: string,
): FixOption[] | undefined {
	const direct = rule.fixOptions?.[key];
	if (direct !== undefined || rule.fixOptions === undefined) {
		return direct;
	}
	for (const phrase of rule.phrases) {
		if (!phrase.includes(PLACEHOLDER)) {
			continue;
		}
		const whole = new RegExp(
			`^${bounded(phrase)}$`,
			rule.caseSensitive === true ? '' : 'i',
		);
		if (whole.test(matched)) {
			const phraseKey =
				rule.caseSensitive === true ? phrase : phrase.toLowerCase();
			return rule.fixOptions[phraseKey];
		}
	}
	return undefined;
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
		const caseSensitive = rule.caseSensitive === true;
		const matcher = buildMatcher(rule.phrases, caseSensitive);
		for (let m = matcher.exec(prose); m !== null; m = matcher.exec(prose)) {
			if (!atWordEdges(prose, m.index, matcher.lastIndex)) {
				// Glued to a letter outside the match (an accented or other
				// non-ASCII one). Resume one character on, so another phrase
				// can still match from the next position.
				matcher.lastIndex = m.index + 1;
				continue;
			}
			// Looked up by the phrase that actually matched, lower-cased (or as
			// written, for a case-sensitive rule), which is how the maps are
			// keyed. A rule with replacements for some of its phrases leaves the
			// rest without a fix.
			const key = caseSensitive ? m[0] : m[0].toLowerCase();
			const replacement = rule.replace?.[key];
			// A case-sensitive rule's suggestion is a spelling to use exactly
			// (a product name), so it is not re-cased to the matched text.
			const options = optionsFor(rule, key, m[0])?.map((option) => ({
				text: caseSensitive
					? option.text
					: matchCase(m[0], option.text),
				source: option.source,
			}));
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
				...(options && options.length > 0
					? { fixOptions: options }
					: {}),
			});
		}
	}
	diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
	return diagnostics;
}
