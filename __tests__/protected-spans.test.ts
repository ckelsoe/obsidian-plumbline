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

	it('tags an Annoteca marker as its own kind', () => {
		const text = 'Before <!-- annoteca/note: x --> after.';
		const spans = protectedSpans(text, config);
		expect(spans).toHaveLength(1);
		expect(spans[0]?.kind).toBe('annoteca-comment');
	});

	it('masks Annoteca markers even when other HTML comments are off', () => {
		const text = 'A <!-- annoteca/note: x --> B <!-- plain --> C';
		const spans = protectedSpans(text, {
			...config,
			protectedSpanKinds: ['annoteca-comment'],
		});
		expect(spans.map((s) => s.kind)).toEqual(['annoteca-comment']);
	});

	it('masks a plain HTML comment even when Annoteca masking is off', () => {
		const text = 'A <!-- annoteca/note: x --> B <!-- plain --> C';
		const spans = protectedSpans(text, {
			...config,
			protectedSpanKinds: ['html-comment'],
		});
		expect(spans.map((s) => s.kind)).toEqual(['html-comment']);
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

	it('does not pair a comment delimiter inside code with one in prose', () => {
		// `<!--` sits in inline code; a lone `-->` is in prose. They must not form
		// a comment that masks the sentence between them.
		const text = 'Use `<!--` in code. Keep this prose visible. -->';
		const spans = protectedSpans(text, config);
		expect(spans.filter((s) => s.kind === 'html-comment')).toHaveLength(0);
		// The inline code is still protected on its own.
		expect(spans.some((s) => s.kind === 'code')).toBe(true);
	});

	it('exposes the base span kinds', () => {
		expect([...BASE_SPAN_KINDS]).toEqual([
			'frontmatter',
			'code',
			'heading',
			'annoteca-comment',
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

// A fence closes only on the same character, at least as many of them. All three
// of these were live: the first is how anyone writes a fenced example OF a
// fenced block, which is exactly how this plugin's own directives get
// documented, and an early close leaves the rest of the example unmasked.
describe('protectedSpans: fence matching', () => {
	const masked = (text: string) =>
		maskSpans(text, protectedSpans(text, config));

	it('does not close a four-backtick fence on an inner three-backtick line', () => {
		const text = [
			'````markdown',
			'```',
			'<!-- plumbline: off -->',
			'```',
			'````',
			'',
			'After.',
		].join('\n');
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.indexOf('\n\nAfter.'), kind: 'code' },
		]);
		expect(masked(text)).toContain('After.');
		expect(masked(text)).not.toContain('plumbline');
	});

	it('does not close a backtick fence with a tilde fence', () => {
		const text = ['```', 'code', '~~~', 'still code', '```', 'After.'].join(
			'\n',
		);
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.indexOf('\nAfter.'), kind: 'code' },
		]);
	});

	it('closes a fence with a longer run of the same character', () => {
		// Markdown allows the closer to be longer than the opener, only not
		// shorter.
		const text = ['```', 'code', '`````', 'After.'].join('\n');
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.indexOf('\nAfter.'), kind: 'code' },
		]);
	});

	// Tildes open a fence too. Without this, dropping tilde support entirely
	// still passed every other assertion here, since they only check that a
	// tilde does not CLOSE a backtick fence.
	it('protects a tilde-fenced block', () => {
		const text = ['Intro.', '~~~js', 'const a = 1;', '~~~', 'After.'].join(
			'\n',
		);
		expect(protectedSpans(text, config)).toEqual([
			{ start: 7, end: text.indexOf('\nAfter.'), kind: 'code' },
		]);
	});

	it('ignores a run of fewer than three fence characters', () => {
		expect(protectedSpans('``\nnot a fence\n``', config)).toEqual([]);
	});
});

// A vault synced from Windows has CRLF notes. Without the `\r?` on both fences
// their frontmatter was not masked at all, so rules fired inside YAML.
describe('protectedSpans: CRLF frontmatter', () => {
	it('masks frontmatter in a CRLF note', () => {
		const text = '---\r\ntitle: A note\r\n---\r\nProse here.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.indexOf('Prose'), kind: 'frontmatter' },
		]);
	});

	it('masks frontmatter in a CRLF note that ends at the closing fence', () => {
		const text = '---\r\ntitle: A note\r\n---';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.length, kind: 'frontmatter' },
		]);
	});

	// The control: the LF form was already handled, so the two assertions above
	// are about the `\r`, not about frontmatter detection in general.
	it('still masks frontmatter in an LF note', () => {
		const text = '---\ntitle: A note\n---\nProse here.';
		expect(protectedSpans(text, config)).toEqual([
			{ start: 0, end: text.indexOf('Prose'), kind: 'frontmatter' },
		]);
	});
});
