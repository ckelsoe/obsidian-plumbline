import type { Diagnostic, FixOption } from './types';

// Name lists (references step 4): a folder of notes about people and places.
// Each note's title and its frontmatter aliases are canonical names, and a
// capitalised word or run of words in prose that is one or two letters off a
// canonical name is flagged, with the name(s) it is probably meant to be.
//
// Thresholds (Charles, 2026-09-24): edit distance 1, or 2 for names of eight
// or more letters; never a name or a word under four letters; never an exact
// match; the prose word must start with a capital letter. A transposed pair of
// letters ("Jonahtan") counts as one edit.

export const NAME_SLUG = 'name-near-miss';
const NAME_PACK_ID = 'name-list';

const LETTER = /\p{L}/u;
const MIN_LETTERS = 4;
const LONG_NAME = 8;

// One canonical name and the lists (references, by display name) it is in.
interface Canonical {
	name: string;
	lower: string;
	letters: number;
	sources: string[];
}

// Canonical names bucketed by word count, then by length, so a prose word is
// only compared with names it could be within two edits of.
export interface NameIndex {
	// Every canonical name and alias, as a compare key, of any length: a word that
	// IS a name is never flagged as a near miss of another.
	exact: ReadonlySet<string>;
	byWords: ReadonlyMap<number, ReadonlyMap<number, readonly Canonical[]>>;
	// The most words any name has, so prose runs are never built longer.
	maxWords: number;
}

export interface NamedList {
	reference: string;
	names: readonly string[];
}

// Letters only: spaces and punctuation ("D'Angelo") do not count toward the
// four-letter minimum or the eight-letter long-name threshold.
function letterCount(text: string): number {
	let n = 0;
	for (const char of text) {
		if (LETTER.test(char)) {
			n++;
		}
	}
	return n;
}

// Collapse runs of whitespace so "Mary  Jane" and "Mary Jane" are one name.
function tidy(name: string): string {
	return name.trim().split(/\s+/).join(' ');
}

// The form names are compared in: lower-cased, with a curly apostrophe read as
// a straight one, so "O’Brien" in prose matches "O'Brien" in a list. One
// character for one, so lengths and edit distances are unchanged.
function compareKey(text: string): string {
	return text.toLowerCase().replace(/’/g, "'");
}

export function buildNameIndex(lists: readonly NamedList[]): NameIndex {
	const merged = new Map<string, Canonical>();
	for (const list of lists) {
		for (const raw of list.names) {
			const name = tidy(raw);
			if (name.length === 0) {
				continue;
			}
			const lower = compareKey(name);
			const current = merged.get(lower) ?? {
				name,
				lower,
				letters: letterCount(name),
				sources: [],
			};
			if (!current.sources.includes(list.reference)) {
				current.sources.push(list.reference);
			}
			merged.set(lower, current);
		}
	}
	const byWords = new Map<number, Map<number, Canonical[]>>();
	let maxWords = 0;
	for (const canonical of merged.values()) {
		if (canonical.letters < MIN_LETTERS) {
			continue;
		}
		const words = canonical.name.split(' ').length;
		maxWords = Math.max(maxWords, words);
		const byLength = byWords.get(words) ?? new Map<number, Canonical[]>();
		const bucket = byLength.get(canonical.lower.length) ?? [];
		bucket.push(canonical);
		byLength.set(canonical.lower.length, bucket);
		byWords.set(words, byLength);
	}
	return { exact: new Set(merged.keys()), byWords, maxWords };
}

// How many names and aliases a list holds, for the setup check's summary.
export function describeNameList(names: number, aliases: number): string {
	const n = `${names} name${names === 1 ? '' : 's'}`;
	return aliases === 0
		? `${n}.`
		: `${n} (${aliases} alias${aliases === 1 ? '' : 'es'}).`;
}

// Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping
// as soon as every path exceeds `max`. Returns max + 1 for "too far".
export function editDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) {
		return max + 1;
	}
	let prevPrev: number[] = [];
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				(prev[j] ?? 0) + 1,
				(row[j - 1] ?? 0) + 1,
				(prev[j - 1] ?? 0) + cost,
			);
			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1]
			) {
				value = Math.min(value, (prevPrev[j - 2] ?? 0) + 1);
			}
			row.push(value);
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) {
			return max + 1;
		}
		prevPrev = prev;
		prev = row;
	}
	const result = prev[b.length] ?? max + 1;
	return result > max ? max + 1 : result;
}

const UPPER = /\p{Lu}/u;

interface Word {
	start: number;
	end: number;
	text: string;
}

// Runs of letters. An apostrophe inside a word ("O'Brien") keeps it whole; a
// possessive ending ("Katherine's") stops at the apostrophe, so the name part
// is what gets compared.
function wordsOf(text: string): Word[] {
	const words: Word[] = [];
	let i = 0;
	while (i < text.length) {
		if (!LETTER.test(text[i] ?? '')) {
			i++;
			continue;
		}
		const start = i;
		while (
			i < text.length &&
			(LETTER.test(text[i] ?? '') ||
				((text[i] === "'" || text[i] === '’') &&
					LETTER.test(text[i + 1] ?? '') &&
					!(
						(text[i + 1] === 's' || text[i + 1] === 'S') &&
						!LETTER.test(text[i + 2] ?? '')
					)))
		) {
			i++;
		}
		words.push({ start, end: i, text: text.slice(start, i) });
	}
	return words;
}

function capitalised(word: Word): boolean {
	return UPPER.test(word.text[0] ?? '');
}

// A name as written, or its plural ("the Bennets", "the Joneses"): a family
// named in the plural is not a misspelling.
function isNameForm(lower: string, index: NameIndex): boolean {
	return (
		index.exact.has(lower) ||
		(lower.endsWith('s') && index.exact.has(lower.slice(0, -1))) ||
		(lower.endsWith('es') && index.exact.has(lower.slice(0, -2)))
	);
}

// The canonical names within the allowed distance of a candidate.
function nearNames(
	candidate: string,
	words: number,
	index: NameIndex,
): Canonical[] {
	const byLength = index.byWords.get(words);
	if (!byLength) {
		return [];
	}
	const lower = compareKey(candidate);
	const out: Canonical[] = [];
	for (let length = lower.length - 2; length <= lower.length + 2; length++) {
		for (const canonical of byLength.get(length) ?? []) {
			const max = canonical.letters >= LONG_NAME ? 2 : 1;
			const distance = editDistance(lower, canonical.lower, max);
			if (distance > 0 && distance <= max) {
				out.push(canonical);
			}
		}
	}
	return out;
}

function nameMessage(matches: readonly Canonical[]): string {
	const first = matches[0];
	if (matches.length === 1 && first) {
		return `${first.sources.join(', ')}: did you mean "${first.name}"?`;
	}
	const each = matches.map((m) => `"${m.name}" (${m.sources.join(', ')})`);
	return `Close to ${each.join(' and ')}. Pick one, or leave it.`;
}

// Find prose words and word runs that are near misses of a canonical name. A
// run starting at a word is tried longest first, and a word inside a run that
// was flagged or that exactly matched a name is not checked again on its own.
export function checkNames(text: string, index: NameIndex): Diagnostic[] {
	if (index.maxWords === 0) {
		return [];
	}
	const words = wordsOf(text);
	const out: Diagnostic[] = [];
	let skipUntil = 0;
	for (let i = 0; i < words.length; i++) {
		const first = words[i];
		if (!first || first.start < skipUntil || !capitalised(first)) {
			continue;
		}
		for (
			let count = Math.min(index.maxWords, words.length - i);
			count >= 1;
			count--
		) {
			const run = words.slice(i, i + count);
			const last = run[run.length - 1];
			// A multi-word name is words separated by single spaces, each
			// capitalised ("Mary Jane", not "Mary. Jane" or "Mary jane").
			const joined = run.every(
				(w, k) =>
					k === 0 ||
					(capitalised(w) &&
						text.slice(run[k - 1]?.end ?? 0, w.start) === ' '),
			);
			if (!last || !joined) {
				continue;
			}
			const candidate = text.slice(first.start, last.end);
			if (isNameForm(compareKey(candidate), index)) {
				skipUntil = last.end;
				break;
			}
			// A word in capitals throughout ("LANE", "NASA") is a heading or an
			// acronym, not a name spelled a letter off.
			if (candidate.length > 1 && candidate === candidate.toUpperCase()) {
				continue;
			}
			if (letterCount(candidate) < MIN_LETTERS) {
				continue;
			}
			const matches = nearNames(candidate, count, index);
			if (matches.length === 0) {
				continue;
			}
			const fixOptions: FixOption[] = matches.map((m) => ({
				text: m.name,
				source: m.sources.join(', '),
			}));
			out.push({
				ruleSlug: NAME_SLUG,
				packId: NAME_PACK_ID,
				severity: 'warning',
				start: first.start,
				end: last.end,
				message: nameMessage(matches),
				findingMessage:
					'Names close to ones in your name lists. Hover each one for the suggestion.',
				fixOptions,
			});
			skipUntil = last.end;
			break;
		}
	}
	return out;
}
