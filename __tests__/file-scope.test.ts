import { fileScope } from '../engine/file-scope';
import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';

describe('fileScope: frontmatter', () => {
	it('reads a profile', () => {
		const text = [
			'---',
			'plumbline-profile: technical',
			'---',
			'Prose.',
		].join('\n');
		expect(fileScope(text).profileId).toBe('technical');
	});

	it('reads disabled rules as a flow list', () => {
		const text = [
			'---',
			'plumbline-disabled-rules: [emphasis-fragment, anaphora]',
			'---',
			'Prose.',
		].join('\n');
		expect(fileScope(text).disabledSlugs.sort()).toEqual([
			'anaphora',
			'emphasis-fragment',
		]);
	});

	it('reads disabled rules as a YAML block list', () => {
		const text = [
			'---',
			'plumbline-disabled-rules:',
			'  - emphasis-fragment',
			'  - anaphora',
			'---',
			'Prose.',
		].join('\n');
		expect(fileScope(text).disabledSlugs.sort()).toEqual([
			'anaphora',
			'emphasis-fragment',
		]);
	});

	// The whole-note opt-out, spelled the way obsidian-linter spells it so a
	// writer does not have to list every rule.
	it('treats `all` as the whole-note opt-out', () => {
		const text = [
			'---',
			'plumbline-disabled-rules: all',
			'---',
			'Prose.',
		].join('\n');
		expect(fileScope(text).disableAll).toBe(true);
	});

	it('ignores a value the slug grammar rejects', () => {
		const text = [
			'---',
			'plumbline-profile: Not A Profile',
			'plumbline-disabled-rules: [OK-CAPS, has space, fine-slug]',
			'---',
			'Prose.',
		].join('\n');
		const s = fileScope(text);
		expect(s.profileId).toBeUndefined();
		expect(s.disabledSlugs).toEqual(['fine-slug']);
	});

	// A note someone is still typing. Reading it as frontmatter would swallow the
	// document.
	it('ignores an unclosed frontmatter fence', () => {
		const text = ['---', 'plumbline-profile: technical', 'Prose.'].join(
			'\n',
		);
		expect(fileScope(text).profileId).toBeUndefined();
	});

	it('ignores a `---` that is not at the top', () => {
		const text = [
			'Prose.',
			'',
			'---',
			'plumbline-profile: technical',
			'---',
		].join('\n');
		expect(fileScope(text).profileId).toBeUndefined();
	});

	it('finds nothing in a plain note', () => {
		expect(fileScope('Just prose.\n')).toEqual({
			profileId: undefined,
			disabledSlugs: [],
			disableAll: false,
			skipRanges: [],
		});
	});
});

describe('fileScope: region directives', () => {
	const between = (text: string) => {
		const s = fileScope(text);
		return s.skipRanges.map((r) => text.slice(r.start, r.end));
	};

	it('skips between off and on', () => {
		const text = 'A. <!-- plumbline: off -->B.<!-- plumbline: on --> C.';
		expect(between(text)).toEqual([
			'<!-- plumbline: off -->B.<!-- plumbline: on -->',
		]);
	});

	it('accepts the disable/enable aliases', () => {
		const text =
			'A. <!-- plumbline-disable -->B.<!-- plumbline-enable --> C.';
		expect(between(text)).toEqual([
			'<!-- plumbline-disable -->B.<!-- plumbline-enable -->',
		]);
	});

	// A writer who opened a region and forgot means "from here on".
	it('runs an unclosed off to the end of the note', () => {
		const text = 'A. <!-- plumbline: off -->B and the rest.';
		expect(between(text)).toEqual([
			'<!-- plumbline: off -->B and the rest.',
		]);
	});

	it('handles several regions', () => {
		const text =
			'<!-- plumbline: off -->a<!-- plumbline: on -->b<!-- plumbline: off -->c<!-- plumbline: on -->';
		expect(fileScope(text).skipRanges).toHaveLength(2);
	});

	it('ignores an on with no off', () => {
		expect(fileScope('A. <!-- plumbline: on --> B.').skipRanges).toEqual(
			[],
		);
	});
});

describe('fileScope: rule directives', () => {
	it('disables and re-enables named slugs', () => {
		expect(
			fileScope(
				'<!-- plumbline: disable anaphora emphasis-fragment -->',
			).disabledSlugs.sort(),
		).toEqual(['anaphora', 'emphasis-fragment']);
		expect(
			fileScope(
				'<!-- plumbline: disable anaphora --><!-- plumbline: enable anaphora -->',
			).disabledSlugs,
		).toEqual([]);
	});

	it('sets the profile', () => {
		expect(
			fileScope('<!-- plumbline: profile technical -->').profileId,
		).toBe('technical');
	});

	// A directive from a newer version must read as a no-op, never as an `off`
	// that silently stops the linter.
	it('ignores a verb it does not know', () => {
		expect(fileScope('<!-- plumbline: teleport now -->')).toEqual({
			profileId: undefined,
			disabledSlugs: [],
			disableAll: false,
			skipRanges: [],
		});
	});

	it('takes disable all as the whole-note opt-out', () => {
		expect(fileScope('<!-- plumbline: disable all -->').disableAll).toBe(
			true,
		);
	});
});

// Interop-contract 4.2, the half that lives in this repo. Annoteca's three
// marker-detecting patterns are anchored on the literal `annoteca/`, and its
// conflict scan reports any `<!-- <namespace>/... -->` comment that is not its
// own. A slash form here would be reported as a conflict in the user's vault by
// a plugin working exactly as designed.
describe('the directive grammar never drifts into a slash form', () => {
	it('does not recognise a slash-form directive', () => {
		for (const text of [
			'<!-- plumbline/off -->',
			'<!-- plumbline/disable anaphora -->',
			'<!-- plumbline/profile technical -->',
		]) {
			expect(fileScope(text)).toEqual({
				profileId: undefined,
				disabledSlugs: [],
				disableAll: false,
				skipRanges: [],
			});
		}
	});

	// The control. The colon forms DO work, so the assertions above mean the
	// slash form was rejected rather than the parser seeing nothing at all.
	// Mutation-checked: dropping the colon from DIRECTIVE_RE fails this, and the
	// drift that would reach a user (grammar and verb reader both learning `/`)
	// fails the test above. Changing only ONE of those two layers survives, which
	// is the point of having both: either alone rejects the slash form.
	it('recognises the colon forms it replaces', () => {
		expect(fileScope('<!-- plumbline: off -->').skipRanges).toHaveLength(1);
		expect(
			fileScope('<!-- plumbline: disable anaphora -->').disabledSlugs,
		).toEqual(['anaphora']);
		expect(
			fileScope('<!-- plumbline: profile technical -->').profileId,
		).toBe('technical');
	});
});

// A directive has to be a directive, not any text shaped like one. Both of these
// are reachable while a writer is working, and both would silence a note.
describe('fileScope: what is not a directive', () => {
	it('ignores one inside a fenced code block', () => {
		const text = [
			'Prose here.',
			'',
			'```markdown',
			'<!-- plumbline: off -->',
			'```',
			'',
			'More prose.',
		].join('\n');
		expect(fileScope(text).skipRanges).toEqual([]);
	});

	it('ignores one inside an inline code span', () => {
		expect(
			fileScope('Write `<!-- plumbline: off -->` to skip a stretch.')
				.skipRanges,
		).toEqual([]);
	});

	it('ignores one inside the frontmatter block', () => {
		const text = [
			'---',
			'note: "<!-- plumbline: off -->"',
			'---',
			'Prose.',
		].join('\n');
		expect(fileScope(text).skipRanges).toEqual([]);
	});

	// The control for the three above: the SAME directive in prose does work, so
	// they are asserting the literal-span guard rather than a broken parser.
	it('honours the same directive in prose', () => {
		expect(
			fileScope('Prose. <!-- plumbline: off -->').skipRanges,
		).toHaveLength(1);
	});

	it('ignores an unterminated comment', () => {
		// `<!-- plumbline: off >` is a writer mid-keystroke, not an instruction to
		// stop checking everything below it.
		expect(fileScope('Prose. <!-- plumbline: off >').skipRanges).toEqual(
			[],
		);
		expect(
			fileScope('<!-- plumbline: disable anaphora >').disabledSlugs,
		).toEqual([]);
		expect(fileScope('<!-- plumbline: profile technical >').profileId).toBe(
			undefined,
		);
	});
});

// End to end, because the literal-span guard is the reason this note keeps being
// linted, and a reader of the guard should be able to see the case it exists for.
describe('documenting the feature does not disable it', () => {
	it('still flags prose after a fenced example of an off directive', () => {
		const text = [
			'How to skip a stretch:',
			'',
			'```markdown',
			'<!-- plumbline: off -->',
			'anything here is left alone',
			'<!-- plumbline: on -->',
			'```',
			'',
			'Read that again.',
		].join('\n');
		const slugs = lint(
			text,
			resolveConfig('scripture-book'),
		).diagnostics.map((d) => d.ruleSlug);
		expect(slugs).toContain('reader-direction');
	});
});
