import { MarkdownView, TFile } from 'obsidian';
import { lint } from './engine/lint';
import { fileScope, isScopeId } from './engine/file-scope';
import {
	ApiFinding,
	FindingsListeners,
	PLUMBLINE_API_VERSION,
	PlumblineApi,
	toApiFinding,
} from './api-model';
import type PlumblinePlugin from './main';

// The read-only API other plugins call, per interop-contract section 6.
// Reached as `app.plugins.getPlugin('plumbline')?.api`, resolved at call time so
// neither plugin holds a handle across the other's reload.
//
// It only reads. Nothing here writes a note, and Plumbline never writes prose or
// markers at all (contract 4.1): promotion goes through Annoteca's API, which is
// the single writer of that channel.
//
// The shape it returns and the subscriber bookkeeping live in api-model.ts, so
// they can be tested without Obsidian.

export class PlumblineApiImpl implements PlumblineApi {
	readonly apiVersion = PLUMBLINE_API_VERSION;

	private readonly listeners = new FindingsListeners();

	constructor(private readonly plugin: PlumblinePlugin) {}

	async findingsFor(path: string): Promise<readonly ApiFinding[]> {
		const text = await this.textFor(path);
		if (text === null) {
			// An unknown path is not an error. The hub asks about whatever note it
			// is showing, and a note deleted or renamed between the two is normal.
			return [];
		}
		// Computed fresh rather than served from the plugin's cached result. The
		// cache only ever holds the ACTIVE note, so serving it would answer a
		// question about one note with another note's findings.
		const result = lint(text, this.plugin.resolvedConfig(text));
		return result.findings.map(toApiFinding);
	}

	onFindingsChanged(cb: (path: string) => void): () => void {
		return this.listeners.add(cb);
	}

	// Called by the plugin whenever a note's findings may have changed: an edit,
	// a config reload, a profile switch, a rule toggle.
	//
	// OPEN notes only. A config change really does change the findings for every
	// note in the vault, and emitting a path for each of them would mean
	// thousands of events for one toggle, most of them about notes nobody is
	// looking at. A consumer caching a closed note's findings can therefore hold
	// a stale copy until that note is opened. That is a deliberate trade rather
	// than an oversight: if a consumer ever needs vault-wide invalidation, the
	// answer is a separate signal saying "the config changed", not a storm of
	// per-path events. See the PL-E notes in the rollout plan.
	emitFindingsChanged(path: string): void {
		this.listeners.emit(path);
	}

	activeProfile(path: string): string {
		const open = this.openEditorText(path);
		if (open !== null) {
			return (
				fileScope(open).profileId ?? this.plugin.settings.activeProfile
			);
		}
		// Closed note: the metadata cache has its frontmatter without a read, so
		// this can stay synchronous as the contract requires. Two limits come
		// with that, both of them the price of not being async:
		//
		// - It does NOT see a `<!-- plumbline: profile ... -->` directive, which
		//   lives in the body. For an open note the branch above reads the real
		//   text and does.
		// - A note the cache has not indexed yet reports the vault profile.
		//   Reachable right after a note is created; measured during PL-E, where
		//   a note read a moment after `vault.create` still had no frontmatter
		//   in the cache and had it about a second later. findingsFor() does not
		//   share this, because it reads the file.
		const frontmatter =
			this.plugin.app.metadataCache.getCache(path)?.frontmatter;
		const cached: unknown = frontmatter?.['plumbline-profile'];
		// Checked against the engine's own grammar, so the API cannot report a
		// profile id the engine would have rejected.
		if (typeof cached === 'string' && isScopeId(cached)) {
			return cached;
		}
		return this.plugin.settings.activeProfile;
	}

	// The live editor text when the note is open, the file otherwise.
	//
	// Order matters. Reading the vault first would resolve against the stale
	// on-disk copy while the editor shows unsaved edits, which is the same trap
	// the contract records for Annoteca's `anchorsFor`: the offsets would be
	// right for a document nobody is looking at.
	private textFor(path: string): Promise<string | null> {
		const open = this.openEditorText(path);
		if (open !== null) {
			return Promise.resolve(open);
		}
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return Promise.resolve(null);
		}
		return this.plugin.app.vault.cachedRead(file);
	}

	private openEditorText(path: string): string | null {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(
			'markdown',
		)) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) {
				return view.editor.getValue();
			}
		}
		return null;
	}
}
