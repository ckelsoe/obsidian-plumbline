import { toEditorText } from '../engine/editor-text';
import { lint } from '../engine/lint';
import { resolveConfig } from '../engine/config';
import { buildReport } from '../report';

// A note with frontmatter and a finding several lines down, so every line
// break above it moves the offset when the endings are not \n.
const LF = [
	'---',
	'plumbline-profile: default',
	'---',
	'# Notes',
	'',
	'First line of prose.',
	'We delve into the tapestry of grace.',
].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');
const CR = LF.replace(/\n/g, '\r');

const config = resolveConfig('default');
const positions = (text: string): [string, number, number][] =>
	lint(text, config).diagnostics.map((d) => [d.ruleSlug, d.start, d.end]);

describe('toEditorText', () => {
	it('turns CRLF and lone CR line breaks into \\n', () => {
		expect(toEditorText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
		expect(toEditorText(CRLF)).toBe(LF);
		expect(toEditorText(CR)).toBe(LF);
	});

	it('returns \\n text unchanged', () => {
		expect(toEditorText(LF)).toBe(LF);
		expect(toEditorText('')).toBe('');
	});
});

describe('positions from a note saved with other line endings', () => {
	it('match the editor once the text is converted', () => {
		const expected = positions(LF);
		expect(expected.length).toBeGreaterThan(0);
		expect(positions(toEditorText(CRLF))).toEqual(expected);
		expect(positions(toEditorText(CR))).toEqual(expected);
	});

	it('are off when the raw file is linted, which is why it is converted', () => {
		expect(positions(CRLF)).not.toEqual(positions(LF));
	});

	it('give report lines that match the editor', () => {
		const line = (text: string): number[] =>
			buildReport('n.md', 'default', text, lint(text, config)).hits.map(
				(h) => h.line,
			);
		const expected = line(LF);
		expect(expected).toContain(7);
		expect(line(toEditorText(CR))).toEqual(expected);
	});
});
