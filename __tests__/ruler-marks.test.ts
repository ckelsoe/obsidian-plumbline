import { rulerMarkTitle, rulerMarks } from '../ruler-marks';
import { Diagnostic, Severity } from '../engine/types';

const hit = (start: number, severity: Severity = 'warning'): Diagnostic => ({
	ruleSlug: 'r',
	packId: 'base',
	severity,
	start,
	end: start + 3,
	message: 'm',
});

describe('rulerMarks', () => {
	it('places a mark at its fraction of the document', () => {
		const marks = rulerMarks([hit(0), hit(500), hit(999)], 1000);
		expect(marks.map((m) => m.position)).toEqual([0, 0.5, 0.995]);
	});

	// A chapter carries hundreds of findings and a node each would be an
	// unreadable smear, so nearby ones share a bucket.
	it('collapses findings that land in the same bucket', () => {
		const marks = rulerMarks([hit(0), hit(1), hit(2)], 1000);
		expect(marks).toHaveLength(1);
		expect(marks[0]?.count).toBe(3);
	});

	it('colours a bucket by its worst severity, whatever order they arrive in', () => {
		expect(
			rulerMarks([hit(0, 'suggestion'), hit(1, 'error')], 1000)[0]
				?.severity,
		).toBe('error');
		expect(
			rulerMarks([hit(0, 'error'), hit(1, 'suggestion')], 1000)[0]
				?.severity,
		).toBe('error');
		expect(
			rulerMarks([hit(0, 'suggestion'), hit(1, 'warning')], 1000)[0]
				?.severity,
		).toBe('warning');
	});

	// Clicking the mark jumps here, so it has to be the first finding in the
	// bucket rather than whichever one happened to be seen last.
	it('jumps to the earliest finding in the bucket', () => {
		// All three inside ONE bucket, and deliberately out of order. Spreading
		// them across buckets made this pass against an implementation that just
		// kept the last offset it saw, because each mark had only one finding.
		const marks = rulerMarks([hit(7), hit(5), hit(9)], 1000);
		expect(marks).toHaveLength(1);
		expect(marks[0]?.count).toBe(3);
		expect(marks[0]?.offset).toBe(5);
	});

	it('returns marks in document order', () => {
		const marks = rulerMarks([hit(900), hit(100), hit(500)], 1000);
		expect(marks.map((m) => m.position)).toEqual([0.1, 0.5, 0.9]);
	});

	// A finding at the very last offset would otherwise land one bucket past the
	// end of the strip and be drawn below it.
	it('keeps a finding at the end of the document inside the strip', () => {
		const marks = rulerMarks([hit(1000)], 1000);
		expect(marks).toHaveLength(1);
		expect(marks[0]?.position).toBeLessThan(1);
	});

	it('has nothing to draw for an empty document', () => {
		expect(rulerMarks([hit(0)], 0)).toEqual([]);
		expect(rulerMarks([], 1000)).toEqual([]);
	});
});

describe('rulerMarkTitle', () => {
	it('says how many and how bad', () => {
		expect(
			rulerMarkTitle({
				position: 0,
				severity: 'warning',
				count: 4,
				offset: 0,
			}),
		).toBe('4 findings here, worst is warning. Click to jump.');
	});

	it('says finding, singular, for one', () => {
		expect(
			rulerMarkTitle({
				position: 0,
				severity: 'error',
				count: 1,
				offset: 0,
			}),
		).toBe('1 finding here, worst is error. Click to jump.');
	});
});
