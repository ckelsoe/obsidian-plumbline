import {
	FindingsListeners,
	PLUMBLINE_API_VERSION,
	toApiFinding,
} from '../api-model';
import { Finding } from '../engine/types';

const finding: Finding = {
	key: 'f-key',
	ruleSlug: 'reader-direction',
	packId: 'base',
	severity: 'warning',
	message: 'Cut it.',
	occurrences: [
		{ start: 0, end: 5, key: 'o-one' },
		{ start: 10, end: 15, key: 'o-two' },
	],
	confidence: 0.9,
	priority: 18,
	rolledUp: true,
};

describe('the API version', () => {
	// Contract 7: the consumer checks this before any call, and unknown or higher
	// means degrade rather than guess. It has to be an integer for that to work.
	it('is an integer', () => {
		expect(Number.isInteger(PLUMBLINE_API_VERSION)).toBe(true);
	});
});

describe('toApiFinding', () => {
	it('carries every field the contract names', () => {
		expect(toApiFinding(finding)).toEqual({
			key: 'f-key',
			ruleSlug: 'reader-direction',
			packId: 'base',
			severity: 'warning',
			message: 'Cut it.',
			occurrences: [
				{ start: 0, end: 5, key: 'o-one' },
				{ start: 10, end: 15, key: 'o-two' },
			],
			confidence: 0.9,
			priority: 18,
			rolledUp: true,
		});
	});

	// A consumer that mutated what it was handed would otherwise be editing the
	// next render's data. Copies, never internals.
	it('hands back no reference into the engine object', () => {
		const out = toApiFinding(finding);
		expect(out.occurrences).not.toBe(finding.occurrences);
		expect(out.occurrences[0]).not.toBe(finding.occurrences[0]);
	});

	// `rolledUp` is not derivable from the occurrence count: a rule can fire
	// twice and still be under the threshold, so it has to travel on its own.
	it('keeps rolledUp independent of how many occurrences there are', () => {
		const twice = toApiFinding({
			...finding,
			rolledUp: false,
		});
		expect(twice.occurrences).toHaveLength(2);
		expect(twice.rolledUp).toBe(false);
	});
});

describe('FindingsListeners', () => {
	it('tells every subscriber which path changed', () => {
		const listeners = new FindingsListeners();
		const seen: string[] = [];
		listeners.add((p) => seen.push(`a:${p}`));
		listeners.add((p) => seen.push(`b:${p}`));
		listeners.emit('ch01.md');
		expect(seen).toEqual(['a:ch01.md', 'b:ch01.md']);
	});

	it('stops telling a subscriber that unsubscribed', () => {
		const listeners = new FindingsListeners();
		const seen: string[] = [];
		const off = listeners.add((p) => seen.push(p));
		listeners.emit('one.md');
		off();
		listeners.emit('two.md');
		expect(seen).toEqual(['one.md']);
		expect(listeners.size).toBe(0);
	});

	it('is safe to unsubscribe twice', () => {
		const listeners = new FindingsListeners();
		const off = listeners.add(() => undefined);
		off();
		off();
		expect(listeners.size).toBe(0);
	});

	// A consumer tearing itself down on the first event it hears is normal. It
	// must not change the set being walked mid-emit.
	it('survives a subscriber that unsubscribes from inside its own callback', () => {
		const listeners = new FindingsListeners();
		const seen: string[] = [];
		const off = listeners.add((p) => {
			seen.push(`self:${p}`);
			off();
		});
		listeners.add((p) => seen.push(`other:${p}`));
		listeners.emit('one.md');
		listeners.emit('two.md');
		expect(seen).toEqual(['self:one.md', 'other:one.md', 'other:two.md']);
	});

	// A live Set visits entries added while it is being iterated, so without the
	// copy a listener subscribed from inside a callback would be called for the
	// event it was not subscribed to, and a consumer that resubscribes on every
	// event would recurse.
	it('does not call a subscriber added during the emit it was added in', () => {
		const listeners = new FindingsListeners();
		const seen: string[] = [];
		let added = false;
		listeners.add((p) => {
			seen.push(`first:${p}`);
			if (!added) {
				added = true;
				listeners.add((q) => seen.push(`late:${q}`));
			}
		});
		listeners.emit('one.md');
		expect(seen).toEqual(['first:one.md']);
		listeners.emit('two.md');
		expect(seen).toEqual(['first:one.md', 'first:two.md', 'late:two.md']);
	});

	// One consumer throwing must not stop the others being told, and must not
	// take down the edit that triggered the emit.
	it('keeps going when a subscriber throws', () => {
		const listeners = new FindingsListeners();
		const errors = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const seen: string[] = [];
		listeners.add(() => {
			throw new Error('consumer blew up');
		});
		listeners.add((p) => seen.push(p));
		expect(() => listeners.emit('ch01.md')).not.toThrow();
		expect(seen).toEqual(['ch01.md']);
		expect(errors).toHaveBeenCalledTimes(1);
		errors.mockRestore();
	});
});
