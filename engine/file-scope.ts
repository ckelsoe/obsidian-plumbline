// Per-file and per-region scoping (PL-D): frontmatter keys and inline directives
// that turn rules off for one note or one stretch of it.
//
// The shape is borrowed from obsidian-linter, which has the idiom right: a
// frontmatter key for the whole file and a comment pair for a region. Writers
// already reach for both, and the author's own notes carry a `<!-- slop-check:
// off -->` header this generalizes.
//
// Pure over the text, so the editor, the CLI and the report all scope the same
// way and cannot disagree about which rules ran.

import { literalSpans } from './protected-spans';

export interface FileScope {
	// From `plumbline-profile` or a `profile` directive. undefined means the
	// plugin's active profile stands.
	profileId: string | undefined;
	// Slugs this note turns off, from either source.
	disabledSlugs: string[];
	// The whole note is opted out. Everything else is then irrelevant.
	disableAll: boolean;
	// Stretches between `off` and `on`, which no rule may fire inside.
	skipRanges: { start: number; end: number }[];
}

// A slug or profile id: the same shape rule slugs already use.
const ID = '[a-z][a-z0-9-]*';

// The directive grammar, deliberately narrow.
//
// COLON ONLY, never `<!-- plumbline/... -->`. Annoteca's three marker-detecting
// patterns are anchored on the literal `annoteca/`, and its conflict scan reports
// any `<!-- <namespace>/...` comment that is not its own. A slash form here would
// therefore be reported as a conflict in the user's vault by a plugin that is
// working correctly. Interop-contract 4.2 pins this from both sides; the last
// describe block in __tests__/file-scope.test.ts is the half that lives here,
// and it carries a colon-form control so the rejection cannot pass vacuously.
//
// Two captures: the marker that says which spelling this is, then everything up
// to the closing `>`.
//
// Linear by construction. `[^>]*` is greedy over a class that cannot match `>`,
// so it stops at the first `>` in one pass with nothing to backtrack over. That
// means the capture swallows the `--` of the terminator, which the reader below
// strips: a lazy `[^>]*?` followed by `\s*-->` reads more naturally and is the
// shape sonarjs flags for super-linear backtracking, on input that is a user's
// note.
const DIRECTIVE_RE = /<!--\s*plumbline(-disable|-enable|:)([^>]*)>/g;

// `plumbline-disabled-rules: [a, b]`, `plumbline-disabled-rules: all`, or a
// YAML list. Parsed with a small reader rather than a YAML dependency, because
// the two keys this cares about are a scalar and a flat list of scalars.

// The frontmatter block, found by scanning rather than by a lazy `[\s\S]*?`
// between two fences. That pattern backtracks across the whole document when
// there is no closing fence, which is a note someone is still typing.
function frontmatterBody(text: string): string | undefined {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
		return undefined;
	}
	const first = text.indexOf('\n') + 1;
	const lines = text.slice(first).split(/\r?\n/);
	const body: string[] = [];
	for (const line of lines) {
		if (/^---[ \t]*$/.test(line)) return body.join('\n');
		body.push(line);
	}
	// No closing fence: not frontmatter, so nothing is read from it.
	return undefined;
}

function readFrontmatter(text: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const body = frontmatterBody(text);
	if (body === undefined) return out;
	const lines = body.split(/\r?\n/);
	let currentKey: string | undefined;
	// Split with string operations rather than regex. Both line patterns were
	// flagged for super-linear backtracking, and neither needs a pattern: one
	// looks for a leading "- " and the other for the first colon. Linear by
	// inspection beats a regex whose complexity has to be argued about.
	for (const line of lines) {
		const trimmed = line.trimStart();

		// A `- item` continuation of the key above it.
		if (trimmed.startsWith('- ') && currentKey !== undefined) {
			const value = trimmed.slice(2).trim();
			if (value !== '') {
				out.get(currentKey)?.push(stripQuotes(value));
			}
			continue;
		}

		const colon = trimmed.indexOf(':');
		if (colon <= 0) {
			currentKey = undefined;
			continue;
		}
		const key = trimmed.slice(0, colon).trimEnd();
		if (!isFrontmatterKey(key)) {
			currentKey = undefined;
			continue;
		}
		const raw = trimmed.slice(colon + 1).trim();
		out.set(key, []);
		currentKey = key;
		if (raw === '') continue;
		// Inline flow list, or a bare scalar.
		const flow = /^\[(.*)\]$/.exec(raw);
		const values = flow ? (flow[1] ?? '').split(',') : [raw];
		for (const v of values) {
			const value = stripQuotes(v.trim());
			if (value !== '') out.get(key)?.push(value);
		}
	}
	return out;
}

// A plain YAML key: a letter, then letters, digits, underscore or dash. Checked
// character by character so there is no pattern to reason about.
function isFrontmatterKey(key: string): boolean {
	if (key.length === 0) return false;
	const first = key.charCodeAt(0);
	const isLetter = (c: number): boolean =>
		(c >= 65 && c <= 90) || (c >= 97 && c <= 122);
	if (!isLetter(first)) return false;
	for (let i = 1; i < key.length; i++) {
		const c = key.charCodeAt(i);
		const ok =
			isLetter(c) ||
			(c >= 48 && c <= 57) || // 0-9
			c === 95 || // _
			c === 45; // -
		if (!ok) return false;
	}
	return true;
}

function stripQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/g, '').trim();
}

// Whether an offset falls inside one of the literal spans. Linear scan: the
// spans are sorted and a note has few of them, and directives are rarer still.
function isLiteral(
	spans: readonly { start: number; end: number }[],
	at: number,
): boolean {
	return spans.some((span) => at >= span.start && at < span.end);
}

// Exported so a caller reading a profile id from somewhere other than the note
// text (the metadata cache, say) validates it against the same grammar the
// engine does, rather than keeping a second copy that can drift.
export function isScopeId(value: string): boolean {
	return isId(value);
}

function isId(value: string): boolean {
	return new RegExp(`^${ID}$`).test(value);
}

export function fileScope(text: string): FileScope {
	const fm = readFrontmatter(text);
	let profileId: string | undefined;
	const disabled = new Set<string>();
	let disableAll = false;

	const fmProfile = fm.get('plumbline-profile')?.[0];
	if (fmProfile !== undefined && isId(fmProfile)) profileId = fmProfile;

	for (const slug of fm.get('plumbline-disabled-rules') ?? []) {
		// `all` is the whole-note opt-out, spelled the way obsidian-linter spells
		// it, so a writer who wants this note left alone does not have to list
		// every rule.
		if (slug === 'all') {
			disableAll = true;
		} else if (isId(slug)) {
			disabled.add(slug);
		}
	}

	// Directives are read in document order, because an `off` has to find its
	// `on`. An unclosed `off` runs to the end of the note, which is what a writer
	// who opened one and forgot means.
	const skipRanges: { start: number; end: number }[] = [];
	let openedAt: number | undefined;
	const literals = literalSpans(text);
	DIRECTIVE_RE.lastIndex = 0;
	for (
		let m = DIRECTIVE_RE.exec(text);
		m !== null;
		m = DIRECTIVE_RE.exec(text)
	) {
		// A directive inside a fence, an inline code span or the frontmatter block
		// is the text it looks like, not an instruction. Writing about this
		// feature means putting `<!-- plumbline: off -->` in a fenced example, and
		// obeying that one would silently stop linting the rest of the note.
		if (isLiteral(literals, m.index)) continue;
		// The trailing `--` of the terminator lands in the second capture, since
		// the class that stops at `>` cannot exclude it. Checked here rather than
		// in the pattern: requiring `-->` in the regex means backtracking over the
		// comment body, which is the shape sonarjs flags. A `<!-- plumbline: off >`
		// is unterminated, so it is text a writer is still typing, not a directive
		// that should silence the rest of the note.
		const marker = m[1] ?? '';
		const raw = m[2] ?? '';
		if (!raw.endsWith('--')) continue;
		const rest = raw.slice(0, -2).trim();
		const words = rest === '' ? [] : rest.split(/\s+/);
		// `plumbline-disable` / `plumbline-enable` name their verb in the marker;
		// the colon form leads with it.
		const verb = marker === ':' ? words[0] : marker.slice(1);
		const args = marker === ':' ? words.slice(1) : words;
		switch (verb) {
			case 'off':
			case 'disable':
				// `disable` with no argument is the region form (the
				// `plumbline-disable` alias); with arguments it names slugs.
				if (args.length === 0) {
					if (openedAt === undefined) openedAt = m.index;
				} else {
					for (const slug of args) {
						if (slug === 'all') {
							disableAll = true;
						} else if (isId(slug)) {
							disabled.add(slug);
						}
					}
				}
				break;
			case 'on':
			case 'enable':
				if (args.length === 0) {
					if (openedAt !== undefined) {
						skipRanges.push({
							start: openedAt,
							end: m.index + m[0].length,
						});
						openedAt = undefined;
					}
				} else {
					for (const slug of args) disabled.delete(slug);
				}
				break;
			case 'profile': {
				const id = args[0];
				if (id !== undefined && isId(id)) profileId = id;
				break;
			}
			default:
				// An unrecognized directive is ignored rather than guessed at. A
				// newer version's verb should read as a no-op here, not as an
				// `off` that silently stops the linter.
				break;
		}
	}
	if (openedAt !== undefined) {
		skipRanges.push({ start: openedAt, end: text.length });
	}

	return {
		profileId,
		disabledSlugs: [...disabled],
		disableAll,
		skipRanges,
	};
}
