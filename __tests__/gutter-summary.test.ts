import {
	countLabel,
	paragraphLineRange,
	summarizeSeverities,
	weightFor,
} from '../gutter-summary';
import { Severity } from '../engine/types';

const many = (n: number, s: Severity): Severity[] => Array<Severity>(n).fill(s);

describe('summarizeSeverities', () => {
	// The case that motivated the summary: 35 findings on one paragraph produced a
	// 5516px tooltip when CodeMirror listed them.
	it('collapses a crowded paragraph into one line', () => {
		const s = summarizeSeverities([
			...many(27, 'warning'),
			...many(8, 'suggestion'),
		]);
		expect(s.message).toBe(
			'35 findings in this paragraph: 27 warnings, 8 suggestions.',
		);
		expect(s.severity).toBe('warning');
	});

	it('orders severities worst first', () => {
		expect(
			summarizeSeverities(['suggestion', 'error', 'warning']).message,
		).toBe(
			'3 findings in this paragraph: 1 error, 1 warning, 1 suggestion.',
		);
	});

	// A paragraph carrying only suggestions must not read "0 errors, 0 warnings".
	it('omits severities that are not present', () => {
		expect(summarizeSeverities(many(4, 'suggestion')).message).toBe(
			'4 findings in this paragraph: 4 suggestions.',
		);
	});

	it('singularizes a count of one', () => {
		expect(summarizeSeverities(['error']).message).toBe(
			'1 finding in this paragraph: 1 error.',
		);
	});

	it('reports the worst severity present, not the commonest', () => {
		expect(
			summarizeSeverities([...many(20, 'suggestion'), 'error']).severity,
		).toBe('error');
		expect(
			summarizeSeverities([...many(20, 'suggestion'), 'warning'])
				.severity,
		).toBe('warning');
		expect(summarizeSeverities(many(20, 'suggestion')).severity).toBe(
			'suggestion',
		);
	});

	// Defensive: the filter is only ever handed a non-empty list by CodeMirror,
	// which calls it from a marker that exists because diagnostics exist. Pinned so
	// a future caller cannot produce "NaN findings" or throw.
	it('does not throw on an empty list', () => {
		const s = summarizeSeverities([]);
		expect(s.message).toBe('No findings in this paragraph.');
		expect(s.severity).toBe('suggestion');
	});
});

// Volume, so the bar answers "how much" and not only "how bad". Colour and
// height alone made one finding and a hundred look identical until you hovered.
describe('weightFor', () => {
	it('is the lightest tier for a single finding', () => {
		expect(weightFor(1)).toBe(1);
	});

	it('steps up past one', () => {
		expect(weightFor(2)).toBe(2);
		expect(weightFor(4)).toBe(2);
	});

	// Tier 3 starts where the default rollup threshold sits, so "this paragraph
	// is the problem" and "a rule fired often enough to roll up" agree.
	it('is the heaviest tier at five and above', () => {
		expect(weightFor(5)).toBe(3);
		expect(weightFor(200)).toBe(3);
	});

	it('never returns a tier outside the three the CSS defines', () => {
		for (let n = 0; n < 300; n++) {
			expect([1, 2, 3]).toContain(weightFor(n));
		}
	});
});

describe('countLabel', () => {
	// A numeral on every flagged paragraph is noise, and the bar's presence
	// already says there is at least one.
	it('prints nothing for a single finding', () => {
		expect(countLabel(1)).toBe('');
		expect(countLabel(0)).toBe('');
	});

	it('prints the count past one', () => {
		expect(countLabel(2)).toBe('2');
		expect(countLabel(37)).toBe('37');
	});

	// Above two digits the numeral stops fitting the gutter.
	it('caps at 99+', () => {
		expect(countLabel(99)).toBe('99');
		expect(countLabel(100)).toBe('99+');
		expect(countLabel(5000)).toBe('99+');
	});
});

describe('summarizeSeverities: volume', () => {
	it('carries the count and the tier alongside the message', () => {
		const s = summarizeSeverities(['warning', 'warning', 'suggestion']);
		expect(s.count).toBe(3);
		expect(s.weight).toBe(2);
		expect(s.message).toBe(
			'3 findings in this paragraph: 2 warnings, 1 suggestion.',
		);
	});

	it('reports a count of zero for an empty list', () => {
		const s = summarizeSeverities([]);
		expect(s.count).toBe(0);
		expect(s.weight).toBe(1);
	});

	// The count is findings, not distinct severities.
	it('counts every finding, not the severities present', () => {
		expect(
			summarizeSeverities(['error', 'error', 'error', 'error', 'error'])
				.count,
		).toBe(5);
		expect(
			summarizeSeverities(['error', 'error', 'error', 'error', 'error'])
				.weight,
		).toBe(3);
	});
});

// A CodeMirror line is not a paragraph. Markdown ends a paragraph at a BLANK
// line, so a writer who hard wraps at eighty columns has one paragraph across
// several lines. Summarizing per line made the gutter show three bars claiming
// "2 findings in this paragraph", "1 finding in this paragraph" for what the
// findings panel showed as one section of three.
describe('paragraphLineRange', () => {
	// 1: "one", 2: "two", 3: "", 4: "four", 5: "five", 6: "six"
	const blanks = new Set([3]);
	const isBlank = (n: number) => blanks.has(n);
	const range = (n: number) => paragraphLineRange(6, isBlank, n);

	it('spans a hard-wrapped paragraph from any line in it', () => {
		expect(range(1)).toEqual({ first: 1, last: 2 });
		expect(range(2)).toEqual({ first: 1, last: 2 });
	});

	it('stops at the blank line, not past it', () => {
		expect(range(4)).toEqual({ first: 4, last: 6 });
		expect(range(6)).toEqual({ first: 4, last: 6 });
	});

	it('does not run off the start or the end of the document', () => {
		expect(range(1).first).toBe(1);
		expect(range(6).last).toBe(6);
	});

	it('handles a single-line document', () => {
		expect(paragraphLineRange(1, () => false, 1)).toEqual({
			first: 1,
			last: 1,
		});
	});

	// A soft-wrapped paragraph is ONE CodeMirror line, which is the common case
	// and has to keep working.
	it('returns just the line when every neighbour is blank', () => {
		expect(paragraphLineRange(3, (n) => n !== 2, 2)).toEqual({
			first: 2,
			last: 2,
		});
	});
});
