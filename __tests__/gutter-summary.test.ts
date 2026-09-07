import { summarizeSeverities } from '../gutter-summary';
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
