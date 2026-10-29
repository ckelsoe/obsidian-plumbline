import { isPauseMinutes, PauseState } from '../pause-state';

const time = (ms: number): string => `t${ms}`;

describe('PauseState', () => {
	it('pauses only the named note, and ends when another note opens', () => {
		const pause = new PauseState();
		pause.pauseNote('a.md');
		expect(pause.isPaused('a.md', 0)).toBe(true);
		expect(pause.isPaused('b.md', 0)).toBe(false);
		// Reopening the same note is not leaving it.
		expect(pause.noteOpened('a.md')).toBe(false);
		expect(pause.isPaused('a.md', 0)).toBe(true);
		expect(pause.noteOpened('b.md')).toBe(true);
		// Coming back finds it checked again.
		expect(pause.isPaused('a.md', 0)).toBe(false);
		expect(pause.noteOpened('a.md')).toBe(false);
	});

	it('pauses everywhere until the set time, then resumes on its own', () => {
		const pause = new PauseState();
		pause.pauseEverywhere(1000);
		expect(pause.isPaused('a.md', 999)).toBe(true);
		expect(pause.isPaused(undefined, 999)).toBe(true);
		expect(pause.statusText('a.md', 999, time)).toBe(
			'Plumbline paused until t1000',
		);
		expect(pause.isPaused('a.md', 1000)).toBe(false);
		expect(pause.any(1000)).toBe(false);
		expect(pause.statusText('a.md', 1000, time)).toBeNull();
	});

	it('an indefinite pause lasts until resumed', () => {
		const pause = new PauseState();
		pause.pauseEverywhere(Infinity);
		expect(pause.isPaused('a.md', Number.MAX_SAFE_INTEGER)).toBe(true);
		expect(pause.statusText('a.md', 0, time)).toBe('Plumbline paused');
		pause.resume();
		expect(pause.isPaused('a.md', 0)).toBe(false);
	});

	it('switching notes does not end a pause everywhere', () => {
		const pause = new PauseState();
		pause.pauseNote('a.md');
		pause.pauseEverywhere(Infinity);
		pause.noteOpened('b.md');
		expect(pause.isPaused('a.md', 0)).toBe(true);
		expect(pause.isPaused('b.md', 0)).toBe(true);
	});

	it('resume clears a note pause too', () => {
		const pause = new PauseState();
		pause.pauseNote('a.md');
		expect(pause.statusText('a.md', 0, time)).toBe(
			'Plumbline paused in this note',
		);
		expect(pause.any(0)).toBe(true);
		pause.resume();
		expect(pause.any(0)).toBe(false);
		expect(pause.isPaused('a.md', 0)).toBe(false);
	});
});

describe('isPauseMinutes', () => {
	it('accepts a positive length up to a day, and nothing else', () => {
		expect(isPauseMinutes(30)).toBe(true);
		expect(isPauseMinutes(1440)).toBe(true);
		// Long enough to overflow setTimeout, which would end the pause at once.
		expect(isPauseMinutes(40000)).toBe(false);
		expect(isPauseMinutes(0)).toBe(false);
		expect(isPauseMinutes(-5)).toBe(false);
		expect(isPauseMinutes(Number.NaN)).toBe(false);
		expect(isPauseMinutes('30')).toBe(false);
	});
});
