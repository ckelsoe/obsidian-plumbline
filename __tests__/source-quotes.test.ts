import {
	buildSourceNoteIndex,
	checkSourceQuotes,
	findLinkedQuotes,
	prepareSourceText,
	quoteInSource,
	SOURCE_QUOTE_SLUG,
} from '../engine/source-quotes';
import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';
import { CONFIDENCE } from '../engine/rollup';

const INTERVIEW = [
	'---',
	'date: 2024-03-02',
	'---',
	'# Interview',
	'',
	'**Dana:** We shipped late because QA was short that quarter. ^a1',
	'We fixed it by hiring two testers.',
].join('\n');

function index(
	folders: { reference: string; notes: [string, string][] }[],
): ReturnType<typeof buildSourceNoteIndex> {
	return buildSourceNoteIndex(
		folders.map((f) => ({
			reference: f.reference,
			notes: f.notes.map(([path, content]) => ({
				path,
				title: (path.split('/').pop() ?? path).replace(/\.md$/, ''),
				text: prepareSourceText(content),
			})),
		})),
	);
}

const interviews = index([
	{
		reference: 'Interviews',
		notes: [['Sources/2024-03-02 Interview.md', INTERVIEW]],
	},
]);

describe('prepareSourceText', () => {
	it('drops frontmatter, emphasis and block IDs, and keeps link text', () => {
		const text = prepareSourceText(
			'---\na: 1\n---\n**Bold** words ^id\nSee [[Note|the note]] and [[Other]].',
		);
		expect(text).toBe('bold words see the note and other.');
	});
});

describe('quoteInSource', () => {
	const source = prepareSourceText(INTERVIEW);

	it('matches regardless of case, quote glyphs, and line breaks', () => {
		expect(quoteInSource('we shipped LATE because QA', source)).toBe(true);
		expect(quoteInSource('that quarter.\nWe fixed it', source)).toBe(true);
	});

	it('ignores punctuation moved inside the closing quote', () => {
		expect(
			quoteInSource('We fixed it by hiring two testers,', source),
		).toBe(true);
	});

	it('treats an ellipsis or an editorial insertion as a gap, in order', () => {
		expect(quoteInSource('We shipped late ... two testers', source)).toBe(
			true,
		);
		expect(quoteInSource('We shipped late … two testers', source)).toBe(
			true,
		);
		expect(quoteInSource('[The team] shipped late because', source)).toBe(
			true,
		);
		expect(quoteInSource('two testers ... We shipped late', source)).toBe(
			false,
		);
	});

	it('matches whole words only, so a shortened word is a misquote', () => {
		expect(quoteInSource('we ship', source)).toBe(false);
		expect(quoteInSource('e shipped late', source)).toBe(false);
		expect(quoteInSource('we shipped', source)).toBe(true);
	});

	it('ignores underscore emphasis and Markdown links in the source', () => {
		const formatted = prepareSourceText(
			'This is _very_ important [today](https://example.com), said snake_case.',
		);
		expect(
			quoteInSource(
				'This is very important today, said snake_case',
				formatted,
			),
		).toBe(true);
	});

	it('reads a Markdown link whose destination holds parentheses', () => {
		for (const url of ['https://e.com/a_(b)', 'https://e.com/a\\)b']) {
			const prepared = prepareSourceText(
				`It was [today](${url}) we shipped.`,
			);
			expect(quoteInSource('today we shipped', prepared)).toBe(true);
		}
	});

	it('reads a source passage written as a blockquote', () => {
		const quoted = prepareSourceText(
			'> We shipped late\n> because QA was short',
		);
		expect(
			quoteInSource('We shipped late because QA was short', quoted),
		).toBe(true);
	});

	it('fails when a word is changed', () => {
		expect(quoteInSource('We shipped early because QA', source)).toBe(
			false,
		);
	});
});

describe('findLinkedQuotes', () => {
	it('finds a quote cited with a wikilink in parentheses or bare', () => {
		const text =
			'She said "we shipped late" ([[Interview]]) and "QA was short" [[Interview|Dana]].';
		const quotes = findLinkedQuotes(text);
		expect(quotes.map((q) => [q.quote, q.link])).toEqual([
			['we shipped late', 'Interview'],
			['QA was short', 'Interview'],
		]);
		expect(text.slice(quotes[0]?.start, quotes[0]?.end)).toBe(
			'"we shipped late"',
		);
	});

	it('finds curly quotes, a dash before the link, and a heading link', () => {
		const quotes = findLinkedQuotes(
			'“We shipped late” — [[Interview#Part 1]]',
		);
		expect(quotes.map((q) => [q.quote, q.link])).toEqual([
			['We shipped late', 'Interview'],
		]);
	});

	it('finds a quote cited through a footnote whose text opens with a link', () => {
		const text =
			'She said "we shipped late"[^1].\n\n[^1]: [[Interview]], 12:30';
		expect(findLinkedQuotes(text).map((q) => q.link)).toEqual([
			'Interview',
		]);
	});

	it('ignores quotes with no citation, embeds, and unrelated links', () => {
		const text = [
			'He said "hello" and left.',
			'"Look" ![[Picture]]',
			'"Plain" (see [[Note]])',
			'[[Note]] was mentioned.',
		].join('\n\n');
		expect(findLinkedQuotes(text)).toEqual([]);
	});

	it('never pairs quote marks across a paragraph break', () => {
		for (const gap of ['\n\n', '\r\n\r\n', '\n  \t\n']) {
			const text = `An open "mark${gap}Then "a quote" ([[Interview]])`;
			expect(findLinkedQuotes(text).map((q) => q.quote)).toEqual([
				'a quote',
			]);
		}
	});

	it('finds single-quoted citations and leaves apostrophes alone', () => {
		const text =
			"She said 'we didn't ship' ([[Interview]]) and ‘we won’t ship’ [[Interview]].";
		expect(findLinkedQuotes(text).map((q) => q.quote)).toEqual([
			"we didn't ship",
			'we won’t ship',
		]);
		const nested =
			'He said "Dana told me \'we shipped late\'" ([[Interview]]).';
		expect(findLinkedQuotes(nested).map((q) => q.quote)).toEqual([
			"Dana told me 'we shipped late'",
		]);
	});

	it('reads a possessive inside a single-quoted citation as an apostrophe', () => {
		const text =
			"She said 'the workers' concerns were heard' ([[Interview]]).";
		expect(findLinkedQuotes(text).map((q) => q.quote)).toEqual([
			"the workers' concerns were heard",
		]);
		const separate = "He said 'hello' and then 'goodbye' ([[Interview]]).";
		expect(findLinkedQuotes(separate).map((q) => q.quote)).toEqual([
			'goodbye',
		]);
	});

	it('reads an elision inside a single-quoted citation as an apostrophe', () => {
		const text = "She said 'we shipped early 'em late' ([[Interview]]).";
		expect(findLinkedQuotes(text).map((q) => q.quote)).toEqual([
			"we shipped early 'em late",
		]);
	});

	it('keeps a nested quotation inside the cited quote', () => {
		const straight =
			'She said "we called it "late" yesterday" ([[Interview]]).';
		expect(findLinkedQuotes(straight).map((q) => q.quote)).toEqual([
			'we called it "late" yesterday',
		]);
		const curly =
			'She said “we called it “late” yesterday” ([[Interview]]).';
		expect(findLinkedQuotes(curly).map((q) => q.quote)).toEqual([
			'we called it “late” yesterday',
		]);
	});

	it('finds a blockquote cited on its last line', () => {
		const text = [
			'Intro.',
			'> We shipped late because',
			'> QA was short.',
			'> ([[Interview]])',
			'',
			'After.',
		].join('\n');
		const [quote] = findLinkedQuotes(text);
		expect(quote?.quote).toBe('We shipped late because QA was short.');
		expect(text.slice(quote?.start, quote?.end)).toBe(
			'We shipped late because\n> QA was short.',
		);
	});

	it('reads a quote callout without its title line', () => {
		const text = '> [!quote] Dana\n> We shipped late. -- [[Interview]]';
		expect(findLinkedQuotes(text).map((q) => q.quote)).toEqual([
			'We shipped late.',
		]);
	});

	it('checks a quoted line inside a blockquote once', () => {
		const text = '> "We shipped late." ([[Interview]])';
		expect(findLinkedQuotes(text)).toHaveLength(1);
	});

	it('skips a blockquote whose last line does not end in a citation', () => {
		const text = '> We shipped late ([[Interview]]) they said.';
		expect(findLinkedQuotes(text)).toEqual([]);
	});
});

describe('checkSourceQuotes', () => {
	it('passes a quote that is in the cited note', () => {
		expect(
			checkSourceQuotes(
				'"We shipped late" ([[2024-03-02 Interview]])',
				interviews,
			),
		).toEqual([]);
	});

	it('flags a quote that is not in the cited note, naming the reference', () => {
		const text = 'Dana said "we shipped early" ([[2024-03-02 Interview]]).';
		const [diag] = checkSourceQuotes(text, interviews);
		expect(diag?.ruleSlug).toBe(SOURCE_QUOTE_SLUG);
		expect(diag?.message).toBe(
			'Interviews: this quote is not in [[2024-03-02 Interview]].',
		);
		expect(text.slice(diag?.start, diag?.end)).toBe('"we shipped early"');
	});

	it('neither passes nor flags a quote with no words to check', () => {
		expect(quoteInSource('[inaudible]', 'anything at all')).toBe(false);
		expect(
			checkSourceQuotes(
				'"[inaudible] ..." ([[2024-03-02 Interview]])',
				interviews,
			),
		).toEqual([]);
	});

	it('skips a link to a note outside every source folder', () => {
		expect(
			checkSourceQuotes('"anything at all" ([[Elsewhere]])', interviews),
		).toEqual([]);
	});

	it('matches a link with a folder path against the end of the note path', () => {
		expect(
			checkSourceQuotes(
				'"we shipped early" ([[Sources/2024-03-02 Interview]])',
				interviews,
			),
		).toHaveLength(1);
		expect(
			checkSourceQuotes(
				'"we shipped early" ([[Other/2024-03-02 Interview]])',
				interviews,
			),
		).toEqual([]);
	});

	it('resolves a relative link from the citing note, exactly', () => {
		const relative =
			'"we shipped early" ([[../Sources/2024-03-02 Interview]])';
		// From Drafts/Article.md, ../Sources/... is Sources/..., the indexed note.
		expect(
			checkSourceQuotes(relative, interviews, 'Drafts/Article.md'),
		).toHaveLength(1);
		// From Project/Drafts/Article.md it is Project/Sources/..., which is not
		// a source note, even though the indexed path ends the same way.
		expect(
			checkSourceQuotes(
				relative,
				interviews,
				'Project/Drafts/Article.md',
			),
		).toEqual([]);
		// Without the citing note's path it cannot be resolved.
		expect(checkSourceQuotes(relative, interviews)).toEqual([]);
	});

	it('names every note a link could mean when none holds the quote', () => {
		const two = index([
			{
				reference: 'Interviews',
				notes: [['A/Dana.md', 'We shipped late.']],
			},
			{
				reference: 'Archive',
				notes: [['B/Dana.md', 'We were on time.']],
			},
		]);
		const [diag] = checkSourceQuotes('"we shipped early" ([[Dana]])', two);
		expect(diag?.message).toBe(
			'This quote is not in [[Dana]] (Interviews) or [[Dana]] (Archive).',
		);
		expect(checkSourceQuotes('"we were on time" ([[Dana]])', two)).toEqual(
			[],
		);
	});
});

describe('lint with source notes', () => {
	const base = resolveConfig('default');
	const withSources = { ...base, sourceNotes: interviews };
	const misquote = '"we shipped early" ([[2024-03-02 Interview]])';
	const flagged = (text: string, config: typeof base): boolean =>
		lint(text, config).diagnostics.some(
			(d) => d.ruleSlug === SOURCE_QUOTE_SLUG,
		);

	it('ranks a misquote with mechanical confidence', () => {
		const finding = lint(misquote, withSources).findings.find(
			(f) => f.ruleSlug === SOURCE_QUOTE_SLUG,
		);
		expect(finding?.confidence).toBe(CONFIDENCE.mechanical);
		expect(CONFIDENCE.mechanical).not.toBe(CONFIDENCE.heuristic);
	});

	it('does not repeat one source for quotes citing different notes', () => {
		const two = index([
			{
				reference: 'Interviews',
				notes: [['A/Dana.md', 'We shipped late.']],
			},
			{ reference: 'Hearings', notes: [['B/Lee.md', 'We adjourned.']] },
		]);
		const config = { ...base, sourceNotes: two };
		const text = '"we shipped early" ([[Dana]]) and "we stayed" ([[Lee]])';
		const result = lint(text, config);
		const messages = result.diagnostics
			.filter((d) => d.ruleSlug === SOURCE_QUOTE_SLUG)
			.map((d) => d.message);
		expect(messages).toEqual([
			'Interviews: this quote is not in [[Dana]].',
			'Hearings: this quote is not in [[Lee]].',
		]);
		const finding = result.findings.find(
			(f) => f.ruleSlug === SOURCE_QUOTE_SLUG,
		);
		expect(finding?.occurrences).toHaveLength(2);
		expect(finding?.message).toBe(
			'Quotes not found in the source notes they cite. Hover each one for its source.',
		);
		// One cited source keeps its specific message on the finding.
		const single = lint('"we shipped early" ([[Dana]])', config);
		expect(
			single.findings.find((f) => f.ruleSlug === SOURCE_QUOTE_SLUG)
				?.message,
		).toBe('Interviews: this quote is not in [[Dana]].');
	});

	it('reports a misquote only when the group has source notes', () => {
		expect(flagged(misquote, base)).toBe(false);
		expect(flagged(misquote, withSources)).toBe(true);
	});

	it('does not check a quote inside code', () => {
		expect(flagged(`\`${misquote}\``, withSources)).toBe(false);
	});

	it('does not check a note that turns the check off', () => {
		const note = (disabled: string): string =>
			[
				'---',
				`plumbline-disabled-rules: [${disabled}]`,
				'---',
				misquote,
			].join('\n');
		expect(flagged(note('some-other-rule'), withSources)).toBe(true);
		expect(flagged(note(SOURCE_QUOTE_SLUG), withSources)).toBe(false);
	});
});
