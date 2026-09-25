import {
	getFrontMatterInfo,
	normalizePath,
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	parseYaml,
} from 'obsidian';
import {
	buildNameIndex,
	describeNameList,
	NameIndex,
} from './engine/name-list';
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
import {
	buildSourceNoteIndex,
	prepareSourceText,
	SourceNoteIndex,
} from './engine/source-quotes';
import { parseChapter } from './engine/verbatim';
import { asStringArray } from './engine/vault-config';
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

// One note read from a source-notes folder, its text prepared for searching.
interface ReadSourceNote {
	path: string;
	title: string;
	text: string;
}

// What one validation pass read, kept so linting never reads a file itself.
interface CheckResult {
	status: ReferenceStatus;
	entries?: TermEntry[];
	notes?: ReadSourceNote[];
	names?: string[];
}

function childFolders(folder: TFolder): TFolder[] {
	return folder.children.filter(
		(child): child is TFolder => child instanceof TFolder,
	);
}

// A note's frontmatter aliases ("aliases" or the older "alias"), as a list or a
// single string. Anything else in the frontmatter, or YAML that does not
// parse, gives none.
function aliasesOf(content: string): string[] {
	const info = getFrontMatterInfo(content);
	if (!info.exists) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(info.frontmatter) as unknown;
	} catch {
		return [];
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return [];
	}
	const obj = parsed as Record<string, unknown>;
	const raw = obj.aliases ?? obj.alias;
	const list = typeof raw === 'string' ? [raw] : asStringArray(raw);
	return list.map((a) => a.trim()).filter((a) => a.length > 0);
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
	// Notes per source-notes reference, and the merged index per group, kept
	// and dropped like the terms and the rule cache.
	private readonly sourceNotes = new Map<string, ReadSourceNote[]>();
	private readonly sourceIndexCache = new Map<string, SourceNoteIndex>();
	// Names (titles and aliases) per name-list reference, and the merged index
	// per group.
	private readonly names = new Map<string, string[]>();
	private readonly nameIndexCache = new Map<string, NameIndex>();
	private saveQueue: Promise<void> = Promise.resolve();
	private readonly pending = new Set<string>();
	private timer: number | null = null;

	constructor(private readonly plugin: PlumblinePlugin) {}

	// Every lint-time view built from the references (term rules, the source
	// note index) depends on the same inputs, so they are dropped together.
	private dropCaches(): void {
		this.ruleCache.clear();
		this.sourceIndexCache.clear();
		this.nameIndexCache.clear();
	}

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
		this.dropCaches();
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
	private async check(reference: Reference): Promise<CheckResult> {
		if (reference.type === 'term-list') {
			return this.checkTermList(reference);
		}
		if (reference.type === 'source-notes') {
			return this.checkSourceNotes(reference);
		}
		if (reference.type === 'name-list') {
			return this.checkNameList(reference);
		}
		return { status: await this.checkQuoteSource(reference) };
	}

	// Every Markdown note in a reference's folder, subfolders included, or a
	// status saying why there is none to read.
	private folderNotes(
		reference: Reference,
	): { files: TFile[] } | { status: ReferenceStatus } {
		const path = reference.path.trim();
		if (path.length === 0) {
			return {
				status: { state: 'invalid', message: 'Choose a folder.' },
			};
		}
		const folder = this.plugin.app.vault.getFolderByPath(
			normalizePath(path),
		);
		if (!folder) {
			return {
				status: {
					state: 'missing',
					message: `Folder not found: ${path}`,
				},
			};
		}
		const files: TFile[] = [];
		Vault.recurseChildren(folder, (child) => {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		});
		return { files };
	}

	// A name list is valid when its folder holds at least one note. Each note's
	// title is a name, and so is each of its frontmatter aliases. A note that
	// cannot be read still gives its title.
	private async checkNameList(reference: Reference): Promise<CheckResult> {
		const found = this.folderNotes(reference);
		if ('status' in found) {
			return { status: found.status };
		}
		if (found.files.length === 0) {
			return {
				status: {
					state: 'invalid',
					message:
						'No notes in this folder. Add one note per person or place, titled with the name.',
				},
			};
		}
		const vault = this.plugin.app.vault;
		const aliasLists = await Promise.all(
			found.files.map(async (file) => {
				try {
					return aliasesOf(await vault.cachedRead(file));
				} catch (err) {
					console.error(err);
					return [];
				}
			}),
		);
		const aliases = aliasLists.flat();
		const names = [...found.files.map((f) => f.basename), ...aliases];
		return {
			status: {
				state: 'ok',
				message: describeNameList(found.files.length, aliases.length),
			},
			names,
		};
	}

	// A source-notes folder is valid when it holds at least one note. Every note
	// in it (subfolders included) is read in this pass and kept, so a cited
	// quote is checked without reading a file while the writer types.
	private async checkSourceNotes(reference: Reference): Promise<CheckResult> {
		const found = this.folderNotes(reference);
		if ('status' in found) {
			return { status: found.status };
		}
		const vault = this.plugin.app.vault;
		const files = found.files;
		if (files.length === 0) {
			return {
				status: {
					state: 'invalid',
					message:
						'No notes in this folder. Add the notes your quotes cite, such as interview transcripts.',
				},
			};
		}
		// A note deleted or unreadable between listing and reading is left out
		// rather than failing the whole folder; it is read again on the next
		// check, which its own vault event triggers.
		const read = await Promise.all(
			files.map(async (file): Promise<ReadSourceNote | null> => {
				try {
					return {
						path: file.path,
						title: file.basename,
						text: prepareSourceText(await vault.cachedRead(file)),
					};
				} catch (err) {
					console.error(err);
					return null;
				}
			}),
		);
		const notes = read.filter((n): n is ReadSourceNote => n !== null);
		if (notes.length === 0) {
			return {
				status: {
					state: 'invalid',
					message: 'Could not read any note in this folder.',
				},
			};
		}
		const count = `${notes.length} source note${notes.length === 1 ? '' : 's'}.`;
		return { status: { state: 'ok', message: count }, notes };
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
	private async checkTermList(reference: Reference): Promise<CheckResult> {
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
		// A check that throws (a file read failing mid-scan) marks this
		// reference invalid instead of aborting the caller's loop over every
		// reference and its refresh.
		let result: CheckResult;
		try {
			result = await this.check(reference);
		} catch (err) {
			console.error(err);
			result = {
				status: {
					state: 'invalid',
					message: 'Could not read this reference. Check it again.',
				},
			};
		}
		const { status, entries, notes, names } = result;
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
		if (notes !== undefined) {
			this.sourceNotes.set(reference.id, notes);
		} else {
			this.sourceNotes.delete(reference.id);
		}
		if (names !== undefined) {
			this.names.set(reference.id, names);
		} else {
			this.names.delete(reference.id);
		}
		this.dropCaches();
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
		this.dropCaches();
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
		this.dropCaches();
		this.statuses.delete(id);
		this.terms.delete(id);
		this.sourceNotes.delete(id);
		this.names.delete(id);
		await this.save();
		this.plugin.applyConfigChange();
	}

	async setAssigned(
		groupId: string,
		referenceId: string,
		on: boolean,
	): Promise<void> {
		setAssigned(this.store, groupId, referenceId, on);
		this.dropCaches();
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
		this.dropCaches();
		await this.save();
	}

	async dropAssignments(groupId: string): Promise<void> {
		if (!(groupId in this.store.assignments)) {
			return;
		}
		delete this.store.assignments[groupId];
		this.dropCaches();
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

	// The notes a group's cited quotes are checked against: every valid
	// source-notes folder it uses, merged by note name, each note naming its
	// reference. Undefined when the group uses none, so lint skips the check.
	sourceNoteIndex(groupId: string): SourceNoteIndex | undefined {
		const cached = this.sourceIndexCache.get(groupId);
		if (cached) {
			return cached.size > 0 ? cached : undefined;
		}
		const folders = this.forGroup(groupId)
			.filter((r) => r.type === 'source-notes')
			.map((r) => ({
				reference: r.name,
				notes: this.sourceNotes.get(r.id) ?? [],
			}))
			.filter((folder) => folder.notes.length > 0);
		const index = buildSourceNoteIndex(folders);
		this.sourceIndexCache.set(groupId, index);
		return index.size > 0 ? index : undefined;
	}

	// The canonical names a group's prose is checked against: every valid name
	// list it uses, merged so a name in two lists names both. Undefined when the
	// group uses none, so lint skips the check.
	nameIndex(groupId: string): NameIndex | undefined {
		let index = this.nameIndexCache.get(groupId);
		if (!index) {
			index = buildNameIndex(
				this.forGroup(groupId)
					.filter((r) => r.type === 'name-list')
					.map((r) => ({
						reference: r.name,
						names: this.names.get(r.id) ?? [],
					})),
			);
			this.nameIndexCache.set(groupId, index);
		}
		return index.maxWords > 0 ? index : undefined;
	}

	// Every quote-source folder in the vault (scripture layout or any notes),
	// whichever group uses it. Their notes are reference text, not quotations,
	// so the verse-cap count leaves them out.
	allQuoteSourcePaths(): string[] {
		return this.store.references
			.filter(
				(r) =>
					(r.type === 'quote-source' || r.type === 'source-notes') &&
					r.path.length > 0,
			)
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
