import {
	PROMOTE_AUTHOR,
	PROMOTE_CATEGORY,
	promoteBody,
	promoteRequestFor,
} from '../promote-request';
import { Diagnostic } from '../engine/types';

const diagnostic: Diagnostic = {
	ruleSlug: 'flagged-register',
	packId: 'base',
	severity: 'warning',
	start: 5,
	end: 13,
	message:
		'Flagged register. Use the plainest word that carries the meaning.',
	key: 'abcd1234',
};

describe('promoteBody', () => {
	it('is the finding alone when the writer said nothing', () => {
		expect(promoteBody(diagnostic, 'leverage', '')).toBe(
			'Plumbline flagged "leverage" (flagged-register): Flagged register. Use the plainest word that carries the meaning.',
		);
	});

	// It says which plugin produced it, so a thread read in the hub is not an
	// anonymous assertion about someone's prose.
	it('names itself as the source', () => {
		expect(promoteBody(diagnostic, 'leverage', '')).toContain('Plumbline');
	});

	// A comment is read in the hub and in exports, away from the prose it sits
	// next to, so it has to say which words it is about.
	it('quotes the flagged words', () => {
		expect(promoteBody(diagnostic, 'seamless', '')).toContain('"seamless"');
	});

	// The rule name is what tells a reader, human or assistant, which check
	// produced this and what to switch off if it is wrong for their voice.
	it('names the rule', () => {
		expect(promoteBody(diagnostic, 'leverage', '')).toContain(
			'(flagged-register)',
		);
	});
});

describe('promoteRequestFor', () => {
	it('builds the request Annoteca expects', () => {
		expect(promoteRequestFor(diagnostic, 'leverage', '')).toEqual({
			category: PROMOTE_CATEGORY,
			body: promoteBody(diagnostic, 'leverage', ''),
			anchor: { start: 5, end: 13 },
			author: PROMOTE_AUTHOR,
			sourceKey: 'abcd1234',
		});
	});

	it('anchors on the diagnostic range, so the marker lands on those words', () => {
		const request = promoteRequestFor(
			{ ...diagnostic, start: 40, end: 48 },
			'seamless',
			'',
		);
		expect(request?.anchor).toEqual({ start: 40, end: 48 });
	});

	// Promotion is idempotent on the source key. Without one, promoting the same
	// finding again would create a second comment and the note would collect
	// duplicates, so refusing is the safe answer.
	it('refuses a finding with no stable key', () => {
		expect(
			promoteRequestFor({ ...diagnostic, key: undefined }, 'x', ''),
		).toBe(null);
		expect(promoteRequestFor({ ...diagnostic, key: '' }, 'x', '')).toBe(
			null,
		);
	});

	it('always claims plumbline as the author', () => {
		expect(promoteRequestFor(diagnostic, 'leverage', '')?.author).toBe(
			'plumbline',
		);
	});
});

// The writer's own words. Without them a promoted comment is the rule talking to
// itself, which is a thread with nothing in it to answer.
describe('promoteBody with a written note', () => {
	it('leads with the writer, then the finding as context', () => {
		expect(
			promoteBody(
				diagnostic,
				'leverage',
				'I like the rhythm of leverage here. Is use really better?',
			),
		).toBe(
			'I like the rhythm of leverage here. Is use really better?\n\nPlumbline flagged "leverage" (flagged-register): Flagged register. Use the plainest word that carries the meaning.',
		);
	});

	it('keeps the finding as context, so a reader knows what triggered it', () => {
		const body = promoteBody(diagnostic, 'leverage', 'Disagree.');
		expect(body).toContain('flagged-register');
		expect(body).toContain('"leverage"');
	});

	it('falls back to the finding alone when nothing was written', () => {
		expect(promoteBody(diagnostic, 'leverage', '   ')).toBe(
			promoteBody(diagnostic, 'leverage', ''),
		);
		expect(promoteBody(diagnostic, 'leverage', '')).not.toContain('\n\n');
	});

	it('trims what the writer typed', () => {
		expect(promoteBody(diagnostic, 'leverage', '  Disagree.  ')).toBe(
			promoteBody(diagnostic, 'leverage', 'Disagree.'),
		);
	});

	it('carries the written note into the request body', () => {
		expect(
			promoteRequestFor(diagnostic, 'leverage', 'Why?')?.body,
		).toContain('Why?');
	});
});
