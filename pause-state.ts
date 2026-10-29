// Live checking can be paused without touching any note: for the note being
// edited until the writer leaves it, everywhere for a set time, or everywhere
// until resumed. Held in memory only, so a restart always resumes. A pause that
// outlived the session would leave a writer wondering why nothing is flagged.
//
// Pure, so the rules for when a pause ends are testable without Obsidian.

// A day. Past about 24.8 days window.setTimeout overflows and fires at once,
// which would leave a pause with no timer to end it; a day is far below that and
// longer than anyone means by "for a while".
export const MAX_PAUSE_MINUTES = 1440;

export function isPauseMinutes(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value > 0 &&
		value <= MAX_PAUSE_MINUTES
	);
}

export class PauseState {
	private notePath: string | null = null;
	// Epoch ms the everywhere pause ends at. Infinity means until resumed.
	private until: number | null = null;

	pauseNote(path: string): void {
		this.notePath = path;
	}

	pauseEverywhere(until: number): void {
		this.until = until;
	}

	resume(): void {
		this.notePath = null;
		this.until = null;
	}

	// Another note became active. A note pause ends there, so coming back to
	// the paused note finds it checked again. Returns whether a pause ended.
	noteOpened(path: string): boolean {
		if (this.notePath === null || this.notePath === path) {
			return false;
		}
		this.notePath = null;
		return true;
	}

	isPaused(path: string | undefined, now: number): boolean {
		return (
			this.pausedEverywhere(now) ||
			(path !== undefined && path === this.notePath)
		);
	}

	// Any pause active anywhere, for showing the resume entry.
	any(now: number): boolean {
		return this.pausedEverywhere(now) || this.notePath !== null;
	}

	// The status bar text while a note is paused, or null when it is not.
	statusText(
		path: string | undefined,
		now: number,
		formatTime: (ms: number) => string,
	): string | null {
		if (this.pausedEverywhere(now) && this.until !== null) {
			return this.until === Infinity
				? 'Plumbline paused'
				: `Plumbline paused until ${formatTime(this.until)}`;
		}
		if (path !== undefined && path === this.notePath) {
			return 'Plumbline paused in this note';
		}
		return null;
	}

	private pausedEverywhere(now: number): boolean {
		return this.until !== null && now < this.until;
	}
}
