import {
	protectedSpans,
	maskSpans,
	BASE_SPAN_KINDS,
} from '../engine/protected-spans';
import { resolveConfig } from '../engine/config';

const config = resolveConfig('scripture-book');

describe('protectedSpans', () => {
	it('detects an ATX heading line', () => {
		const text = '# Chapter one\nPlain prose here.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: 13, kind: 'heading' },
		]);
	});

	it('detects a fenced code block including its fences', () => {
		const text = 'Intro line.\n```js\nconst a = 1;\n```\nAfter.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 12, end: 34, kind: 'code' },
		]);
	});

	it('protects an unterminated fence through end of document', () => {
		const text = 'Before.\n```\nstill open';
		const spans = protectedSpans(text, config);
		expect(spans).toEqual([{ start: 8, end: text.length, kind: 'code' }]);
	});

	it('detects inline code', () => {
		const text = 'Use `foo()` here.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 4, end: 11, kind: 'code' },
		]);
	});

	it('detects leading frontmatter', () => {
		const text = '---\ntitle: x\n---\nBody.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: 17, kind: 'frontmatter' },
		]);
	});

	it('honors the active span kinds', () => {
		const text = '# Heading\nBody.';
		const noHeadings = { ...config, protectedSpanKinds: ['code'] };
		expect(protectedSpans(text, noHeadings)).toEqual([]);
	});

	it('detects a single-line HTML comment', () => {
		const text = 'Before <!-- a note --> after.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 7, end: 22, kind: 'html-comment' },
		]);
	});

	it('detects a multi-line HTML comment including its lines', () => {
		const text = 'Intro.\n<!--\nhidden\n-->\nAfter.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 7, end: 22, kind: 'html-comment' },
		]);
	});

	it('closes each HTML comment at its own terminator', () => {
		const text = '<!-- one --> mid <!-- two -->';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: 12, kind: 'html-comment' },
			{ start: 17, end: 29, kind: 'html-comment' },
		]);
	});

	it('leaves an unterminated HTML comment unmasked', () => {
		const text = 'Prose <!-- still typing';
		expect(protectedSpans(text, config)).toEqual([]);
	});

	it('exposes the base span kinds', () => {
		expect([...BASE_SPAN_KINDS]).toEqual([
			'frontmatter',
			'code',
			'heading',
			'html-comment',
		]);
	});
});

describe('maskSpans', () => {
	it('blanks protected ranges but preserves length and newlines', () => {
		const text = '# H\nBody here.';
		const masked = maskSpans(text, protectedSpans(text, config));
		expect(masked).toBe('   \nBody here.');
		expect(masked.length).toBe(text.length);
	});

	it('returns the text unchanged when there are no spans', () => {
		expect(maskSpans('Plain prose.', [])).toBe('Plain prose.');
	});

	it('blanks an Annoteca marker but keeps the prose around it', () => {
		const text =
			'Real prose. <!-- annoteca/note: it is important to note --> More prose.';
		const masked = maskSpans(text, protectedSpans(text, config));
		expect(masked).not.toContain('important to note');
		expect(masked).toContain('Real prose.');
		expect(masked).toContain('More prose.');
		expect(masked.length).toBe(text.length);
	});
});
