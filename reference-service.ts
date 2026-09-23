import { normalizePath, Notice, TAbstractFile, TFile, TFolder } from 'obsidian';
import {
	checkQuoteSourceLayout,
	LayoutTranslation,
} from './engine/corpus-layout';
import {
	emptyReferenceStore,
	followRename,
	isAssigned,
	parseReferenceStore,
	Reference,
	REFERENCES_PATH,
	referencesForGroup,
	ReferenceStore,
	removeReference,
	serializeReferenceStore,
	setAssigned,
	uniqueReferenceId,
} from './engine/reference-store';
import { parseChapter } from './engine/verbatim';
import {
	buildTermRules,
	describeTermList,
	parseTermList,
	TermEntry,
} from './engine/term-list';
import type { Rule } from './engine/types';
import type PlumblinePlugin from './main';

// The state of one reference, shown on the References page. Validation runs when
// a reference is set up or its path changes (Charles's requirement), and again
// when the vault changes under it; checks never raise a notice for a broken
// reference while the writer is typing, they just skip it.
export interface ReferenceStatus {
	state: 'ok' | 'invalid' | 'missing';
	message: string;
}

// A stored reference path is always in Obsidian's normal form, so every prefix
// comparison (re-checks, rename following) matches what the vault reports. An
// empty path stays empty: normalizePath('') would turn it into "/".
function storedPath(path: string): string {
	const trimmed = path.trim();
	return trimmed.length > 0 ? normalizePath(trimmed) : '';
}

// How long after the last vault change under a reference to re-check it.
const REVALIDATE_DELAY = 500;

function childFolders(folder: TFolder): TFolder[] {
	return folder.children.filter(
		(child): child is TFolder => child instanceof TFolder,
	);
}

// Plugin-side owner of the references store: persistence, validation, vault
// rename tracking, group assignments, and the one-time migration of the 0.2.1
// scripture-folder setting. The pure rules live in engine/reference-store.ts.
export class ReferenceService {
	private store: ReferenceStore = emptyReferenceStore();
	private readonly statuses = new Map<string, ReferenceStatus>();
	// Parsed terms per term-list reference, refreshed whenever it is validated.
	private readonly terms = new Map<string, TermEntry[]>();
	// Merged term rules per group. Every lint pass asks for them, so they are
	// built once and dropped whenever a term list, a reference's name or type,
	// or a group's choice of references changes.
	private readonly ruleCache = new Map<string, Rule[]>();
	private saveQueue: Promise<void> = Promise.resolve();
	private readonly pending = new Set<string>();
	private timer: number | null = null;

	constructor(private readonly plugin: PlumblinePlugin) {}

	list(): Reference[] {
		return [...this.store.references];
	}

	get(id: string): Reference | undefined {
		return this.store.references.find((r) => r.id === id);
	}

	status(id: string): ReferenceStatus | undefined {
		return this.statuses.get(id);
	}

	forGroup(groupId: string): Reference[] {
		return referencesForGroup(this.store, groupId);
	}

	isAssigned(groupId: string, referenceId: string): boolean {
		return isAssigned(this.store, groupId, referenceId);
	}

	// The names of the groups (by id) that use a reference.
	groupIdsUsing(referenceId: string): string[] {
		return Object.keys(this.store.assignments).filter((groupId) =>
			this.isAssigned(groupId, referenceId),
		);
	}

	async load(): Promise<void> {
		this.ruleCache.clear();
		try {
			const adapter = this.plugin.app.vault.adapter;
			this.store = (await adapter.exists(REFERENCES_PATH))
				? parseReferenceStore(
						JSON.parse(
							await adapter.read(REFERENCES_PATH),
						) as unknown,
					)
				: emptyReferenceStore();
			// A hand-edited file may hold "Bible/" or a backslash path.
			for (const reference of this.store.references) {
				reference.path = storedPath(reference.path);
			}
		} catch (err) {
			console.error(err);
			this.store = emptyReferenceStore();
		}
	}

	// Persist through a queue so two quick edits cannot interleave their writes.
	// The file lives in the .plumbline dot-folder, which the Vault API does not
	// index, so it goes through the adapter like groups.json and checks.json.
	private async save(): Promise<boolean> {
		let ok = true;
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				const adapter = this.plugin.app.vault.adapter;
				if (!(await adapter.exists('.plumbline'))) {
					await adapter.mkdir('.plumbline');
				}
				await adapter.write(
					REFERENCES_PATH,
					serializeReferenceStore(this.store),
				);
			} catch (err) {
				ok = false;
				console.error(err);
				// A save failure is the one reference problem worth a notice: the
				// change the writer just made did not stick.
				new Notice('Plumbline: could not save the references.');
			}
		});
		await this.saveQueue;
		return ok;
	}

	// Validate every reference, e.g. once the vault has finished loading.
	async validateAll(): Promise<void> {
		for (const reference of this.store.references) {
			await this.revalidate(reference);
		}
		// Notes opened before this ran were linted with no term lists loaded,
		// so re-lint them now that the terms are in.
		this.plugin.applyConfigChange();
		this.plugin.onReferencesChanged();
	}

	// Setup validation: the path exists and its content parses in the type's
	// format. For a quote source that means the folder layout matches and a
	// sampled chapter note carries ^vN verse markers. For a term list it also
	// returns the terms read in that same pass, so the caller never needs a
	// second read that could race a path change.
	private async check(
		reference: Reference,
	): Promise<{ status: ReferenceStatus; entries?: TermEntry[] }> {
		if (reference.type === 'term-list') {
			return this.checkTermList(reference);
		}
		return { status: await this.checkQuoteSource(reference) };
	}

	private async checkQuoteSource(
		reference: Reference,
	): Promise<ReferenceStatus> {
		const path = reference.path.trim();
		if (path.length === 0) {
			return { state: 'invalid', message: 'Choose a folder.' };
		}
		const folder = this.plugin.app.vault.getFolderByPath(
			normalizePath(path),
		);
		if (!folder) {
			return { state: 'missing', message: `Folder not found: ${path}` };
		}
		const translations: LayoutTranslation[] = childFolders(folder).map(
			(translation) => ({
				name: translation.name,
				books: childFolders(translation).map((book) => ({
					name: book.name,
					files: book.children
						.filter(
							(child): child is TFile => child instanceof TFile,
						)
						.map((file) => file.name),
				})),
			}),
		);
		const layout = checkQuoteSourceLayout(translations);
		if (!layout.ok || !layout.sample) {
			return { state: 'invalid', message: layout.message };
		}
		const { translation, book, file } = layout.sample;
		const sample = this.plugin.app.vault.getFileByPath(
			`${folder.path}/${translation}/${book}/${file}`,
		);
		const verses = sample
			? parseChapter(await this.plugin.app.vault.cachedRead(sample))
			: new Map<number, string>();
		if (verses.size === 0) {
			return {
				state: 'invalid',
				message: `${translation}/${book}/${file} has no verse markers. End each verse with a block ID like ^v1.`,
			};
		}
		return { state: 'ok', message: layout.message };
	}

	// Validation awaits a file read, so the reference may be deleted or re-pointed
	// meanwhile; a late result for it is dropped rather than resurrecting its
	// status.
	// A term list is valid when its note exists and at least one term parses
	// from it. The parsed terms are kept, so linting never re-reads the file.
	private async checkTermList(
		reference: Reference,
	): Promise<{ status: ReferenceStatus; entries?: TermEntry[] }> {
		const path = reference.path.trim();
		if (path.length === 0) {
			return { status: { state: 'invalid', message: 'Choose a note.' } };
		}
		const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
		if (!file) {
			return {
				status: {
					state: 'missing',
					message: `Note not found: ${path}`,
				},
			};
		}
		const entries = parseTermList(
			await this.plugin.app.vault.cachedRead(file),
		);
		if (entries.length === 0) {
			return {
				status: {
					state: 'invalid',
					message:
						'No terms found. Add a table with a column such as "Do not use" or "Avoid", or bullets that open with a quoted phrase.',
				},
			};
		}
		return {
			status: { state: 'ok', message: describeTermList(entries) },
			entries,
		};
	}

	// The path is captured up front so a slower check of an old path cannot
	// overwrite the result for a path chosen since.
	private async revalidate(reference: Reference): Promise<void> {
		const path = reference.path;
		const type = reference.type;
		const { status, entries } = await this.check(reference);
		if (
			this.get(reference.id) !== reference ||
			reference.path !== path ||
			reference.type !== type
		) {
			return;
		}
		this.statuses.set(reference.id, status);
		if (entries !== undefined) {
			this.terms.set(reference.id, entries);
		} else {
			this.terms.delete(reference.id);
		}
		this.ruleCache.clear();
	}

	async create(): Promise<string> {
		const taken = new Set(this.store.references.map((r) => r.id));
		const reference: Reference = {
			id: uniqueReferenceId('New reference', taken),
			name: 'New reference',
			type: 'quote-source',
			path: '',
		};
		this.store.references.push(reference);
		await this.revalidate(reference);
		await this.save();
		return reference.id;
	}

	async rename(id: string, name: string): Promise<void> {
		const reference = this.get(id);
		if (!reference) {
			return;
		}
		reference.name = name;
		this.ruleCache.clear();
		await this.save();
		// A term finding names its list, so open notes re-lint with the new name.
		this.plugin.applyConfigChange();
	}

	// Change a reference's path and validate it straight away, so the editor can
	// show the result as soon as the folder is chosen.
	async setPath(
		id: string,
		path: string,
	): Promise<ReferenceStatus | undefined> {
		const reference = this.get(id);
		if (!reference) {
			return undefined;
		}
		reference.path = storedPath(path);
		await this.revalidate(reference);
		await this.save();
		this.plugin.applyConfigChange();
		return this.statuses.get(id);
	}

	// Change what kind of reference this is. The path is kept, and checked again
	// against the new type's format.
	async setType(
		id: string,
		type: Reference['type'],
	): Promise<ReferenceStatus | undefined> {
		const reference = this.get(id);
		if (!reference) {
			return undefined;
		}
		reference.type = type;
		await this.revalidate(reference);
		await this.save();
		this.plugin.applyConfigChange();
		return this.statuses.get(id);
	}

	async delete(id: string): Promise<void> {
		removeReference(this.store, id);
		this.ruleCache.clear();
		this.statuses.delete(id);
		this.terms.delete(id);
		await this.save();
		this.plugin.applyConfigChange();
	}

	async setAssigned(
		groupId: string,
		referenceId: string,
		on: boolean,
	): Promise<void> {
		setAssigned(this.store, groupId, referenceId, on);
		this.ruleCache.clear();
		await this.save();
		this.plugin.applyConfigChange();
	}

	// A duplicated or forked group checks against the same files as its source.
	async copyAssignments(
		fromGroupId: string,
		toGroupId: string,
	): Promise<void> {
		const from = this.store.assignments[fromGroupId];
		if (!from) {
			return;
		}
		this.store.assignments[toGroupId] = [...from];
		this.ruleCache.clear();
		await this.save();
	}

	async dropAssignments(groupId: string): Promise<void> {
		if (!(groupId in this.store.assignments)) {
			return;
		}
		delete this.store.assignments[groupId];
		this.ruleCache.clear();
		await this.save();
	}

	// Vault events. A rename or move is followed; any other change under a
	// reference's path re-runs its validation, so a deleted folder shows as
	// Missing and a restored one recovers without the writer touching settings.
	async onVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (followRename(this.store, oldPath, file.path)) {
			await this.save();
			this.plugin.onReferencesChanged();
		}
		this.revalidateTouching(file.path);
		this.revalidateTouching(oldPath);
	}

	onVaultChange(file: TAbstractFile): void {
		this.revalidateTouching(file.path);
	}

	// Deleting or moving a folder fires one event per file inside it, so the
	// affected references are collected and re-checked once, shortly after the
	// burst, rather than once per event.
	private revalidateTouching(path: string): void {
		for (const reference of this.store.references) {
			const root = reference.path;
			if (
				root.length > 0 &&
				(path === root ||
					path.startsWith(`${root}/`) ||
					root.startsWith(`${path}/`))
			) {
				this.pending.add(reference.id);
			}
		}
		if (this.pending.size > 0 && this.timer === null) {
			this.timer = window.setTimeout(() => {
				this.timer = null;
				void this.flushPending();
			}, REVALIDATE_DELAY);
		}
	}

	private async flushPending(): Promise<void> {
		const ids = [...this.pending];
		this.pending.clear();
		for (const id of ids) {
			const reference = this.get(id);
			if (reference) {
				await this.revalidate(reference);
			}
		}
		this.plugin.applyConfigChange();
		this.plugin.onReferencesChanged();
	}

	// Called from the plugin's onunload so no timer outlives the plugin.
	dispose(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		this.pending.clear();
	}

	// The folders of a group's valid quote sources, in the order chosen. A missing
	// or invalid reference is skipped quietly.
	quoteSourceFolders(
		groupId: string,
	): { reference: Reference; folder: TFolder }[] {
		const out: { reference: Reference; folder: TFolder }[] = [];
		for (const reference of this.forGroup(groupId)) {
			if (reference.type !== 'quote-source') {
				continue;
			}
			const folder = this.plugin.app.vault.getFolderByPath(
				normalizePath(reference.path),
			);
			if (folder && this.statuses.get(reference.id)?.state === 'ok') {
				out.push({ reference, folder });
			}
		}
		return out;
	}

	// The term rules for a group: every valid term list it uses, merged so a term
	// in two lists is one rule naming both, with every suggestion kept.
	termRules(groupId: string): Rule[] {
		const cached = this.ruleCache.get(groupId);
		if (cached) {
			return cached;
		}
		const lists = this.forGroup(groupId)
			.filter((r) => r.type === 'term-list')
			.map((r) => ({ name: r.name, entries: this.terms.get(r.id) ?? [] }))
			.filter((list) => list.entries.length > 0);
		const rules = lists.length > 0 ? buildTermRules(lists) : [];
		this.ruleCache.set(groupId, rules);
		return rules;
	}

	// Every quote-source folder in the vault, whichever group uses it. Their notes
	// are reference text, not quotations, so the verse-cap count leaves them out.
	allQuoteSourcePaths(): string[] {
		return this.store.references
			.filter((r) => r.type === 'quote-source' && r.path.length > 0)
			.map((r) => normalizePath(r.path));
	}

	// One-time migration of the 0.2.1 flat "Scripture folder" setting: it becomes
	// a "Bible text" quote-source reference, used by every group that draws on the
	// scripture pack. Returns true when it migrated, so the caller clears the
	// setting.
	async migrateScriptureFolder(
		folder: string,
		scriptureGroupIds: readonly string[],
	): Promise<boolean> {
		const path = storedPath(folder);
		if (path.length === 0) {
			return false;
		}
		const taken = new Set(this.store.references.map((r) => r.id));
		const reference: Reference = {
			id: uniqueReferenceId('Bible text', taken),
			name: 'Bible text',
			type: 'quote-source',
			path,
		};
		this.store.references.push(reference);
		for (const groupId of scriptureGroupIds) {
			setAssigned(this.store, groupId, reference.id, true);
		}
		// Report success only if the reference really reached disk: the caller
		// deletes the old setting on true, and losing both would lose the
		// writer's configuration for good. On failure the in-memory reference is
		// dropped too, so the next load retries the migration from the setting.
		if (await this.save()) {
			return true;
		}
		removeReference(this.store, reference.id);
		return false;
	}
}
