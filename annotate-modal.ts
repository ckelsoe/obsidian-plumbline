import { App, Modal, Setting } from 'obsidian';

// What the writer says when they turn a finding into a comment.
//
// Without this the promoted comment carried only the rule's own words, which
// makes a thread with nothing in it to answer. The point of promoting is to
// disagree with a finding, ask whether it is right, or leave a note for the
// assistant reading the file, and all of that is the writer's text, not the
// engine's.

export class AnnotateModal extends Modal {
	// Every exit has to answer, or the caller awaits a promise nothing settles.
	// Escape, the close button and a click on the background all reach onClose
	// without touching the buttons, so the flag is tracked here rather than
	// inferred from the DOM.
	private decided = false;
	private note = '';

	constructor(
		app: App,
		private readonly phrase: string,
		private readonly ruleSlug: string,
		private readonly message: string,
		private readonly onDecision: (note: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Add a comment' });

		// The finding, shown but not editable. It is the reason the writer is
		// here, and re-reading it in the note means leaving this dialog.
		const context = contentEl.createDiv({
			cls: 'plumbline-annotate-context',
		});
		context.createEl('strong', { text: `"${this.phrase}"` });
		context.createSpan({
			cls: 'plumbline-annotate-rule',
			text: this.ruleSlug,
		});
		contentEl.createEl('p', {
			cls: 'plumbline-annotate-message',
			text: this.message,
		});

		new Setting(contentEl)
			.setName('Your comment')
			.setDesc(
				'What you want to say about this. A question, a disagreement, or a note for whoever reads the file next.',
			)
			.addTextArea((area) => {
				area.setPlaceholder(
					'Leave empty to record the finding on its own.',
				);
				area.onChange((value) => {
					this.note = value;
				});
				// Enter with a modifier submits, the way every comment box
				// does. Plain Enter stays a newline: this is a paragraph, not
				// a single-line field. Registered here rather than on a
				// captured handle, where the element is properly typed.
				area.inputEl.addEventListener('keydown', (event) => {
					if (
						event.key === 'Enter' &&
						(event.metaKey || event.ctrlKey)
					) {
						event.preventDefault();
						this.submit();
					}
				});
				// Focused so the writer can type immediately. They opened this
				// to say something.
				window.setTimeout(() => area.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Add comment')
					.setCta()
					.onClick(() => {
						this.submit();
					}),
			);
	}

	private submit(): void {
		this.decided = true;
		this.onDecision(this.note.trim());
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) {
			// Backed out. `null`, distinct from an empty string, which means
			// "add it with no words of mine".
			this.decided = true;
			this.onDecision(null);
		}
	}
}
