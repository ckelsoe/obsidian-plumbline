import {
	DEFAULT_ROW_CAP,
	buildPanelModel,
	sectionSummary,
} from '../panel-model';
import { CONFIDENCE } from '../engine/rollup';
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
	ruleSlug: slug,
	packId: 'base',
	severity,
	message: `${slug} message`,
	occurrences: starts.map((s) => ({ start: s, end: s + 5 })),
	confidence,
	priority: 0,
	rolledUp: starts.length > 4,
});

describe('buildPanelModel: grouping by paragraph', () => {
	it('puts each finding in the paragraph its occurrences fall in', () => {
		const m = buildPanelModel(TEXT, [
			finding('a', 'warning', [0]),
			finding('b', 'warning', [P2_START]),
		]);
		expect(m.sections.map((s) => s.paragraph)).toEqual([1, 2]);
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
		expect(m.sections[0]?.paragraph).toBe(1);
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
