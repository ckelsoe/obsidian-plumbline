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
	it('leads with the message, then names the words and the rule', () => {
		expect(promoteBody(diagnostic, 'leverage')).toBe(
			'Flagged register. Use the plainest word that carries the meaning. Flagged "leverage" (flagged-register).',
		);
	});

	// A comment is read in the hub and in exports, away from the prose it sits
	// next to, so it has to say which words it is about.
	it('quotes the flagged words', () => {
		expect(promoteBody(diagnostic, 'seamless')).toContain('"seamless"');
	});

	// The rule name is what tells a reader, human or assistant, which check
	// produced this and what to switch off if it is wrong for their voice.
	it('names the rule', () => {
		expect(promoteBody(diagnostic, 'leverage')).toContain(
			'(flagged-register)',
		);
	});
});

describe('promoteRequestFor', () => {
	it('builds the request Annoteca expects', () => {
		expect(promoteRequestFor(diagnostic, 'leverage')).toEqual({
			category: PROMOTE_CATEGORY,
			body: promoteBody(diagnostic, 'leverage'),
			anchor: { start: 5, end: 13 },
			author: PROMOTE_AUTHOR,
			sourceKey: 'abcd1234',
		});
	});

	it('anchors on the diagnostic range, so the marker lands on those words', () => {
		const request = promoteRequestFor(
			{ ...diagnostic, start: 40, end: 48 },
			'seamless',
		);
		expect(request?.anchor).toEqual({ start: 40, end: 48 });
	});

	// Promotion is idempotent on the source key. Without one, promoting the same
	// finding again would create a second comment and the note would collect
	// duplicates, so refusing is the safe answer.
	it('refuses a finding with no stable key', () => {
		expect(promoteRequestFor({ ...diagnostic, key: undefined }, 'x')).toBe(
			null,
		);
		expect(promoteRequestFor({ ...diagnostic, key: '' }, 'x')).toBe(null);
	});

	it('always claims plumbline as the author', () => {
		expect(promoteRequestFor(diagnostic, 'leverage')?.author).toBe(
			'plumbline',
		);
	});
});
