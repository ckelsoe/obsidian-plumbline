import {
	DEFAULT_ROW_CAP,
	buildPanelModel,
	sectionSummary,
	excerptOf,
} from '../panel-model';
import { CONFIDENCE, priorityOf } from '../engine/rollup';
import { Finding, Severity } from '../engine/types';

// Two paragraphs, so grouping has something to group by. Offsets are what the
// model works from, so the fixture text matters.
const P1 = 'First paragraph here with some words in it.';
const P2 = 'Second paragraph here with other words in it.';
const TEXT = `${P1}\n\n${P2}`;
const P2_START = TEXT.indexOf(P2);

const finding = (
	slug: string,
	severity: Severity,
	starts: number[],
	confidence = CONFIDENCE.mechanical,
): Finding => ({
	key: `f-${slug}`,
	ruleSlug: slug,
	packId: 'base',
	severity,
	message: `${slug} message`,
	occurrences: starts.map((s) => ({ start: s, end: s + 5, key: `k${s}` })),
	confidence,
	// The real WHOLE-NOTE priority, not a placeholder. Zero here made the
	// per-paragraph ranking test vacuous: every priority tied, the sort fell
	// through to its alphabetical tiebreak, and it gave the expected order by
	// luck whether or not the model recomputed anything. Caught by mutation.
	priority: priorityOf(severity, starts.length, confidence),
	rolledUp: starts.length > 4,
});

describe('buildPanelModel: grouping by paragraph', () => {
	it('puts each finding in the paragraph its occurrences fall in', () => {
		const m = buildPanelModel(TEXT, [
			finding('a', 'warning', [0]),
			finding('b', 'warning', [P2_START]),
		]);
		expect(m.sections.map((s) => s.paragraphIndex)).toEqual([1, 2]);
		expect(m.sections[0]?.rows[0]?.ruleSlug).toBe('a');
		expect(m.sections[1]?.rows[0]?.ruleSlug).toBe('b');
	});

	// The point of grouping by paragraph: a rule firing across the note reports
	// where it fired HERE, not a whole-note count the reader cannot locate.
	it('splits one finding across the paragraphs it touches', () => {
		const m = buildPanelModel(TEXT, [
			finding('a', 'warning', [0, 10, P2_START]),
		]);
		expect(m.sections).toHaveLength(2);
		expect(m.sections[0]?.rows[0]?.occurrences).toHaveLength(2);
		expect(m.sections[1]?.rows[0]?.occurrences).toHaveLength(1);
	});

	it('skips a paragraph with nothing in it', () => {
		const m = buildPanelModel(TEXT, [finding('a', 'warning', [0])]);
		expect(m.sections).toHaveLength(1);
		expect(m.sections[0]?.paragraphIndex).toBe(1);
	});

	it('has no sections for no findings', () => {
		expect(buildPanelModel(TEXT, [])).toEqual({ sections: [], hidden: 0 });
	});
});

describe('buildPanelModel: ranking', () => {
	it('ranks by this paragraph count, not the whole-note one', () => {
		// `spread` fires once here and three times in paragraph two; `local`
		// fires twice here. Ranked by the whole-note count, spread would lead.
		const m = buildPanelModel(TEXT, [
			finding('spread', 'warning', [
				0,
				P2_START,
				P2_START + 7,
				P2_START + 14,
			]),
			finding('local', 'warning', [10, 20]),
		]);
		expect(m.sections[0]?.rows.map((r) => r.ruleSlug)).toEqual([
			'local',
			'spread',
		]);
	});

	it('puts an error above a warning that fired more often', () => {
		const m = buildPanelModel(TEXT, [
			finding('warn', 'warning', [0, 10, 20]),
			finding('err', 'error', [30]),
		]);
		expect(m.sections[0]?.rows[0]?.ruleSlug).toBe('err');
	});
});

describe('buildPanelModel: the severity floor', () => {
	it('collapses suggestions and keeps errors and warnings as rows', () => {
		const m = buildPanelModel(TEXT, [
			finding('warn', 'warning', [0]),
			finding('s1', 'suggestion', [10]),
			finding('s2', 'suggestion', [20]),
		]);
		const s = m.sections[0];
		expect(s?.rows.map((r) => r.ruleSlug)).toEqual(['warn']);
		// Occurrences, not rules, so this and the section header count the same
		// thing. Two rules firing once each is two suggestions either way; the
		// case that separates them is below.
		expect(s?.collapsed.count).toBe(2);
		// Never silently hidden: expanding shows them.
		expect(s?.collapsed.rows.map((r) => r.ruleSlug)).toEqual(['s1', 's2']);
	});

	// One rule firing five times is "5 suggestions" in the header, so it has to
	// be 5 on the button too. Counting rules put "1 suggestion" under "5
	// suggestions" in the same block.
	it('counts collapsed occurrences, not collapsed rules', () => {
		const m = buildPanelModel(TEXT, [
			finding('s1', 'suggestion', [0, 5, 10, 15, 20]),
		]);
		const s = m.sections[0];
		expect(s?.collapsed.count).toBe(5);
		expect(s?.collapsed.rows).toHaveLength(1);
		expect(s && sectionSummary(s)).toBe('5 suggestions');
	});

	it('keeps a paragraph that has only suggestions', () => {
		const m = buildPanelModel(TEXT, [finding('s1', 'suggestion', [0])]);
		expect(m.sections).toHaveLength(1);
		expect(m.sections[0]?.rows).toEqual([]);
		expect(m.sections[0]?.collapsed.count).toBe(1);
	});
});

describe('buildPanelModel: the row cap', () => {
	const many = (n: number, para = 0): Finding[] =>
		Array.from({ length: n }, (_, i) =>
			finding(`r${String(i).padStart(3, '0')}`, 'warning', [para + i]),
		);

	it('caps the rows and reports how many are hidden', () => {
		const m = buildPanelModel(TEXT, many(30), 25);
		const shown = m.sections.reduce((n, s) => n + s.rows.length, 0);
		expect(shown).toBe(25);
		expect(m.hidden).toBe(5);
	});

	it('hides nothing under the cap', () => {
		const m = buildPanelModel(TEXT, many(3), 25);
		expect(m.hidden).toBe(0);
	});

	it('ships a cap of 25', () => {
		expect(DEFAULT_ROW_CAP).toBe(25);
		expect(buildPanelModel(TEXT, many(30)).hidden).toBe(5);
	});

	// A collapsed group is ONE row however many findings it stands for, which is
	// what makes collapsing worth doing.
	it('counts a collapsed group as a single row', () => {
		const m = buildPanelModel(
			TEXT,
			[
				...many(2),
				finding('s1', 'suggestion', [30]),
				finding('s2', 'suggestion', [31]),
				finding('s3', 'suggestion', [32]),
			],
			3,
		);
		expect(m.hidden).toBe(0);
		expect(m.sections[0]?.collapsed.count).toBe(3);
	});
});

describe('sectionSummary', () => {
	it('counts occurrences, worst severity first, omitting what is absent', () => {
		const m = buildPanelModel(TEXT, [
			finding('err', 'error', [0]),
			finding('warn', 'warning', [10, 20]),
			finding('s', 'suggestion', [30]),
		]);
		const s = m.sections[0];
		expect(s && sectionSummary(s)).toBe(
			'1 error, 2 warnings, 1 suggestion',
		);
	});

	it('names only what is there', () => {
		const m = buildPanelModel(TEXT, [finding('s', 'suggestion', [0, 10])]);
		const s = m.sections[0];
		expect(s && sectionSummary(s)).toBe('2 suggestions');
	});
});

// The cap has to bind on collapsed groups too. Counting one as hidden while
// still returning it let the renderer draw its button and every row behind it,
// so a note whose findings are all suggestions rendered well past the cap while
// offering a "Show N more" for rows it was already showing.
describe('buildPanelModel: the cap binds on collapsed groups', () => {
	// One suggestion per paragraph, across many paragraphs: every section is a
	// collapsed group and nothing else.
	const manyParagraphs = (n: number) => {
		const paras = Array.from(
			{ length: n },
			(_, i) => `Paragraph ${i} text.`,
		);
		const text = paras.join('\n\n');
		const findings: Finding[] = paras.map((p, i) => {
			const at = text.indexOf(p);
			return finding(`s${i}`, 'suggestion', [at]);
		});
		return { text, findings };
	};

	it('stops returning collapsed groups once the cap is reached', () => {
		const { text, findings } = manyParagraphs(10);
		const m = buildPanelModel(text, findings, 4);
		const drawn = m.sections.reduce(
			(n, s) => n + s.rows.length + (s.collapsed.rows.length > 0 ? 1 : 0),
			0,
		);
		expect(drawn).toBe(4);
		expect(m.hidden).toBe(6);
	});

	// A section kept only for a group that did not fit would be an empty header.
	it('drops a section whose only content did not fit', () => {
		const { text, findings } = manyParagraphs(10);
		const m = buildPanelModel(text, findings, 4);
		for (const s of m.sections) {
			expect(s.rows.length + s.collapsed.rows.length).toBeGreaterThan(0);
		}
	});

	it('still returns every group when they all fit', () => {
		const { text, findings } = manyParagraphs(3);
		const m = buildPanelModel(text, findings, 25);
		expect(m.sections).toHaveLength(3);
		expect(m.hidden).toBe(0);
	});
});

// The summary is a claim about the PROSE, not about what the panel happens to be
// drawing. Counting the visible rows made a paragraph with 30 warnings read
// "25 warnings" with a "Show 5 more" sitting under it.
describe('sectionSummary is not affected by the cap or the floor', () => {
	it('counts every warning in the paragraph, not the capped rows', () => {
		const findings = Array.from({ length: 30 }, (_, i) =>
			finding(`r${String(i).padStart(3, '0')}`, 'warning', [i]),
		);
		const m = buildPanelModel(TEXT, findings, 25);
		const s = m.sections[0];
		expect(s?.rows).toHaveLength(25);
		expect(m.hidden).toBe(5);
		expect(s && sectionSummary(s)).toBe('30 warnings');
	});

	it('counts collapsed suggestions even when the group did not fit', () => {
		const m = buildPanelModel(
			TEXT,
			[
				finding('w', 'warning', [0]),
				finding('s', 'suggestion', [10, 20, 30]),
			],
			1,
		);
		const s = m.sections[0];
		// The group is dropped from the section, but it still happened.
		expect(s?.collapsed.rows).toHaveLength(0);
		expect(s && sectionSummary(s)).toBe('1 warning, 3 suggestions');
	});
});

// An occurrence belongs to exactly one paragraph. Assigning by overlap put a
// range crossing a blank line into both, duplicating its row and counting it
// twice across two summaries. Reachable because a paragraph without terminal
// punctuation lets a sentence run past the blank line, and several heuristics
// flag the whole sentence.
describe('buildPanelModel: an occurrence lands in one paragraph only', () => {
	it('does not duplicate a finding that spans a paragraph break', () => {
		const spanning: Finding = {
			key: 'f-wide',
			ruleSlug: 'wide',
			packId: 'base',
			severity: 'warning',
			message: 'spans the break',
			// Starts in paragraph one, ends inside paragraph two.
			occurrences: [{ start: 5, end: P2_START + 10, key: 'kspan' }],
			confidence: CONFIDENCE.heuristic,
			priority: 0,
			rolledUp: false,
		};
		const m = buildPanelModel(TEXT, [spanning]);
		expect(m.sections).toHaveLength(1);
		expect(m.sections[0]?.paragraphIndex).toBe(1);
		expect(m.sections[0]?.counts.warning).toBe(1);
	});

	it('still places an occurrence that starts in the second paragraph', () => {
		const m = buildPanelModel(TEXT, [
			finding('b', 'warning', [P2_START + 2]),
		]);
		expect(m.sections.map((s) => s.paragraphIndex)).toEqual([2]);
	});
});

// How a section is LOCATED. The paragraph ordinal used to be the label, and it
// counted headings, so it named a paragraph the reader would never arrive at by
// counting. Line number plus opening words replaced it.
describe('buildPanelModel: locating a section', () => {
	const NOTE = [
		'# Chapter One',
		'',
		'A clean opening paragraph with nothing wrong in it.',
		'',
		'## A subheading',
		'',
		'Read that again.',
	].join('\n');

	const model = () =>
		buildPanelModel(NOTE, [
			{
				key: 'k',
				ruleSlug: 'reader-direction',
				packId: 'base',
				severity: 'warning',
				message: 'Cut it.',
				occurrences: [
					{
						start: NOTE.indexOf('Read that again.'),
						end: NOTE.indexOf('Read that again.') + 15,
						key: 'o',
					},
				],
				confidence: 0.9,
				priority: 9,
				rolledUp: false,
			},
		]);

	it('reports the line the paragraph starts on', () => {
		// The flagged line is line 7 of the note, which is what the editor's own
		// gutter shows.
		expect(model().sections[0]?.line).toBe(7);
	});

	it('carries the opening words as the excerpt', () => {
		expect(model().sections[0]?.excerpt).toBe('Read that again.');
	});

	// The bug this replaced: two headings consumed ordinals 1 and 3, so what a
	// reader calls the second paragraph was labelled "Paragraph 4". The ordinal
	// still counts that way, which is exactly why it is no longer a label.
	it('keeps the heading-counting ordinal internal', () => {
		expect(model().sections[0]?.paragraphIndex).toBe(4);
	});
});

describe('excerptOf', () => {
	it('collapses whitespace and trims', () => {
		expect(excerptOf('  Some   prose\n  wrapped here.  ')).toBe(
			'Some prose wrapped here.',
		);
	});

	it('strips a leading blockquote marker', () => {
		expect(excerptOf('> Quoted prose here.')).toBe('Quoted prose here.');
	});

	it('strips a leading list marker', () => {
		expect(excerptOf('- A listed point.')).toBe('A listed point.');
		expect(excerptOf('1. A numbered point.')).toBe('A numbered point.');
	});

	it('leaves a short paragraph whole, with no marker', () => {
		expect(excerptOf('Short enough.')).toBe('Short enough.');
	});

	// A label ending mid-word reads as corruption rather than as a truncation.
	it('cuts a long paragraph at a word boundary', () => {
		const long =
			'This opening sentence runs on well past the excerpt limit and keeps going.';
		const out = excerptOf(long);
		expect(out.endsWith('...')).toBe(true);
		expect(out.length).toBeLessThanOrEqual(51);
		const body = out.slice(0, -3);
		expect(long.startsWith(body)).toBe(true);
		// The cut landed BETWEEN words: the next character in the original is a
		// space, so the last kept word is whole. A hard slice at the limit lands
		// mid-word and reads as corruption rather than as a truncation.
		expect(long[body.length]).toBe(' ');
		expect(body.endsWith(' ')).toBe(false);
	});

	// A single very long word has no boundary worth honouring; cutting at the
	// last space would collapse the label to almost nothing.
	it('cuts mid-word rather than return almost nothing', () => {
		const out = excerptOf(`Aa ${'x'.repeat(80)}`);
		expect(out.length).toBeGreaterThan(40);
	});
});
