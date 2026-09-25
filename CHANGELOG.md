<!-- slop-check: off (quotes the flagged vocabulary the plugin catches, such as leverage and utilize, as worked examples) -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Quotes from your own sources: a new reference type, "Quote source (any notes)", points at a folder of notes such as interview transcripts, statutes, or source documents. Cite a quote with a wikilink to its source note, straight after the quote or in a footnote, and Plumbline underlines the quote if it is not in that note. Case, quote marks, line breaks, moved punctuation, and the source note's formatting are ignored; an ellipsis or a bracketed insertion marks a gap. Choosing the folder checks it straight away and reports how many source notes it found.

## [0.4.0] - 2026-09-23

### Added
- Term lists: point a group at a note of words and phrases to avoid, such as a brand voice file, a house style guide, or a product glossary, and every note that group checks is flagged where it uses one, with a one-click replacement where the list names one. The note is plain Markdown: tables with a "Do not use" or "Avoid" column (and, optionally, a "Use instead" column), and bullets that open with a quoted phrase. The brand voice skill's tables work as they are. Set one up under References, then turn it on for a group.
- When two term lists disagree about a term, the finding says so and the hover offers every suggestion, each labelled with its list, so you choose. The same term in two lists is one finding naming both.
- A term that differs from its replacement only in case, such as a product name, is matched exactly, so the correct spelling is never flagged.

### Changed
- A phrase that ends in punctuation, such as "Period." or "Here's the thing:", now matches at the end of a sentence. Word boundaries apply only on a side of a phrase that ends in a letter or digit.

## [0.3.0] - 2026-09-23

### Added
- References: named files and folders that checks compare against, defined once under Settings > References and turned on per group in the group editor. A group can use several at once, and a starter group can use one without being copied first. Bible text for "Check quoted scripture" is the first kind. Choosing a folder checks it straight away and reports what it found ("2 translations, 66 books, 1,189 chapters") or exactly what to fix. A renamed or moved folder is followed; a deleted one shows as Missing and is skipped.

### Changed
- The "Scripture folder" setting from 0.2.1 is now a reference. An existing setting becomes a "Bible text" reference used by every group with the scripture checks, the first time the vault opens, so nothing needs setting again.
- The three scripture commands appear in the command palette only when the note you are in is checked with a group that includes the scripture checks.
- "Check quoted scripture" uses the references of the note's own group, so a note that picks its group in frontmatter is checked against that group's sources.

## [0.2.1] - 2026-09-23

### Added
- A "Scripture folder" setting. "Check quoted scripture" now reads the Bible text from a folder you choose, and the README documents the layout it expects: one folder per translation, one folder per book, one note per chapter, with each verse ending in a `^vN` block ID. Before, the folder was fixed to a layout only the author's vault had, so the check found nothing anywhere else. The translation folder now matches your citation's code whatever its case.

### Changed
- Until a scripture folder is chosen, "Check quoted scripture" says so instead of reporting that no verse could be found. A vault that used the old fixed `10-bibles` folder needs that folder chosen once in settings.
- Verse caps leave out the notes in the chosen scripture folder, rather than a fixed `10-bibles` folder.

## [0.2.0] - 2026-09-23

### Added
- Writing groups choose which checks run on a note. A group names the packs it draws from and tunes them, and the two starters ship read-only as worked examples to clone. The engine resolves a group into the same per-note config as before, so this is a foundation, not a behaviour change.
- Set a check's severity and the roll-up threshold from settings, no JSON editing. Each active check row now carries a severity dropdown beside its on/off toggle, and a Volume section sets how many repeats of one check collapse into a single findings row. A per-note override still wins. Choosing a check's own default severity clears the override rather than storing a no-op.
- Manage your own writing groups. Under "Manage groups" you can create a group, rename it, duplicate one, and delete your own; duplicating a starter is how you customize it. Tuning a read-only starter's checks makes an editable copy and switches to it, so the two starters stay pristine. Your groups live in `.plumbline/groups.json`, so they travel with the vault and can be shared. Check tuning now lives on the active group rather than in one flat file, and any tuning you had saved in `.plumbline/config.json` moves into a group the first time you open the vault.
- A per-check editor. Each check in the "Active rules" list now opens an editor showing whether it runs, its severity, how much it is trusted (confidence), and when repeats collapse into one row. Each knob inherits the check's own default until you override it, so a group only records what you changed, and the editor lists the groups the check is turned on in. The row itself shows the effective severity, or "Off", so the ruleset still reads at a glance.
- A check library, with your own checks. Create a phrase check of your own, edit its wording and phrases, and delete it; the library also turns any built-in on or off in the active group and searches the whole set by name or message. A built-in's matching stays locked so an update can improve it without clobbering your edits, but Duplicate makes an editable copy you can change. Your custom checks live in `.plumbline/checks.json` and travel with the vault. A custom check is off in a group until you turn it on.
- Rule toggles in settings: the settings tab lists every built-in rule for the active group, both the mechanical phrase rules and the cross-sentence heuristics, each with an on/off switch, so the ruleset is visible and adjustable without hand-editing `.plumbline/config.json`. A toggle rewrites only the disabled list; the file is re-read first, so any hand-authored overrides, custom rules, or edits made since load are preserved.
- The findings panel is organised by paragraph. Each paragraph you have flagged gets its own section with a one-line count, the rules worth acting on listed under it in order, and suggestions collapsed into a single row you can open. A rule that fired several times in a paragraph shows the count and expands to every place it fired, so you can step through them instead of only jumping to the first. Long lists cap at 25 rows with a button that says how many more there are.
- Findings are grouped and ranked. A rule that fires again and again through a chapter now reports as one row carrying every place it fired, instead of one row per hit, and the list is ordered by how much each rule is worth your attention rather than by where it appears. Measured over 25 real chapters: 297 raw hits became 93 rows, and the worst chapter went from 24 hits to 5 rows. The ordering weighs how severe a rule is, how often it fired, and how often that kind of rule is right, so a single misquoted verse outranks fifteen notes about vague phrasing. Both the grouping threshold and the per-rule weighting are tunable in `.plumbline/config.json`.
- A severity bar in the editor gutter. Each paragraph carrying findings gets a colored bar beside it, in the color of the worst finding in that paragraph, and the bar is as tall as the paragraph, so a long stretch of flagged prose reads as a long bar. Hovering it gives a one-line count, for example "35 findings in this paragraph: 27 warnings, 8 suggestions". The bar points at a paragraph, never at a phrase, which is what the editor's gutter can address; the underline and the findings panel are where a phrase is located.
- The gutter now counts a whole paragraph, not a single line. A paragraph hard-wrapped across several source lines was reported as several separate paragraphs, each with its own count, while the findings panel showed it as one. Both surfaces now agree.
- Every finding now names the rule that fired, in the panel and in the hover. Without it the per-note rule setting was unusable: you cannot switch off a rule the plugin refuses to name, and the only way to find the name was to read the source.
- A flagged word that has one plain replacement can be swapped in one click. The hover offers it, the change goes into the editor's normal undo history so one undo puts your word back, and the replacement takes the capitalisation of the word it replaces. Only phrases with a single right answer carry one: "leverage" becomes "use", while "intricate" and "tapestry" are left to you, because a confident wrong suggestion costs you your own phrasing.
- A rule can be turned off for the note you are in, from the hover. It writes the rule into the note's own frontmatter, so the choice is visible at the top of the note and can be undone by editing it.
- A finding can be turned into an Annoteca comment from the hover, so a note you disagree with becomes a thread you can answer instead of a warning you can only silence. The dialog lets you pick the category, from the list you already use in Annoteca, starting on "Prose check". It asks what you want to say first: your words lead the comment and the finding follows as context, so whoever reads the file next, a person or an assistant, has your question and what triggered it. Leaving the box empty records the finding on its own. The comment is anchored to the flagged words, records that Plumbline created it, and carries the finding's stable id, so promoting the same finding twice does nothing rather than leaving two copies. The button is absent when Annoteca is not installed or is too old to accept it.
- A setting for the underline under flagged phrases: always, never, or yield to comments. Yielding is the default and only does anything when Annoteca is installed: where you already have an open comment on a passage, the underline steps aside, because someone is working that sentence and does not need a second machine marking it. A comment you have resolved does not hide it, and neither does one with an edit waiting on you, since that prose is back in play. The gutter bar and the findings panel always show everything, so nothing is lost, only the inline mark.
- Clicking an underlined phrase opens the findings panel and points at that finding, briefly highlighting the row. It works for a suggestion too, opening the collapsed group it lives in, which is where most findings sit. The click still places your cursor, because a click on a word is an editing gesture first.
- A command writes flags reports for every note in the current note's folder, instead of one note at a time. Handing a whole chapter folder to a collaborator reading the JSON no longer means running the command once per file. Notes are read from disk, so a note with unsaved edits is reported as saved.
- A command adds comments for every finding in the note at once, through Annoteca. It is a command and never automatic: a finding disappears when you fix the prose, but a comment stays until you close it, so silently creating one for every false positive would leave you closing threads forever. The whole batch goes in one call, so Annoteca's confirmation shows the real total and asks once.
- More one-click fixes. A new rule catches longer words doing a shorter word's job (utilize, facilitate, regarding, prior to, in order to, due to the fact that) and every one of them offers the plain word. The doubled hedges "may perhaps" and "could potentially" now offer the single word too.
- A strip beside the scrollbar shows where the findings are in the whole document, coloured by the worst one in each spot. A long chapter now has a shape you can see without scrolling, and clicking a mark jumps there.
- The gutter bar now shows how much is wrong, not only how bad. Its thickness steps up with the number of findings in the paragraph, and past one finding it prints the count beside it, so a paragraph with one problem and a paragraph with thirty no longer look identical until you hover.
- The findings panel locates each group by line number and the paragraph's opening words instead of a paragraph number. The old label counted headings as paragraphs, so it named a paragraph you would never arrive at by counting: in a note with two headings, the second paragraph of prose was labelled "Paragraph 4". A line number matches the editor's own gutter, and the opening words tell you which passage it is without leaving the panel.
- Per-note scoping. A note can pick its own writing profile, turn individual rules off, or opt out of checking entirely, through `plumbline-profile` and `plumbline-disabled-rules` in its frontmatter (`plumbline-disabled-rules: all` opts the whole note out). Inside a note, `<!-- plumbline: off -->` and `<!-- plumbline: on -->` bracket a stretch nothing should fire on, and `<!-- plumbline-disable -->` / `<!-- plumbline-enable -->` do the same thing if you already have that habit from other plugins. A skipped stretch is left out of the rhythm metrics too, so burstiness is measured over the prose you are actually writing rather than over a block quote you excluded. `<!-- plumbline: disable <rule> -->`, `<!-- plumbline: enable <rule> -->` and `<!-- plumbline: profile <id> -->` do the same as the frontmatter keys, and an unclosed `off` runs to the end of the note. The decision is made in one place, so the editor, the JSON report and every command scope a note the same way.
- A read-only API other plugins can call, so a companion tool sees this note's findings without re-implementing the engine. It hands back the ranked, rolled-up findings for any note, a way to be told when a note's findings change, and which profile is active for it. It only reads: nothing another plugin does through it can alter a note or a setting. Annoteca, the commenting plugin, is the first consumer.
- Every finding now carries a stable id, and so does each place it fired. The id survives a re-lint and survives edits elsewhere in the note, and it changes when the flagged phrase itself changes, because edited prose is a new finding. That is what lets another tool tell a finding it has already acted on from one it has not, without comparing positions that shift on every keystroke.
- The `.plumbline/` folder gains an `index.json` listing every report that has been written, with the note it belongs to, its profile, and how many findings it had. A collaborator working on the filesystem reads one file instead of walking the vault and guessing which JSON goes with which note. Report files are also named so two notes can no longer collide: `a/b.md` and `a-b.md` previously produced the same filename, and the second report written silently replaced the first.

### Fixed
- A severity you set on a cross-sentence heuristic (like anaphora or emphasis fragment) now takes effect. Before, the dropdown saved the choice but the linter kept flagging at the built-in severity, so the setting looked broken. The per-check roll-up threshold is now honored the same way, so one noisy check can collapse to a single row sooner than the rest of its group.
- The squiggle under a flagged phrase was invisible. Every CSS property was set correctly, but both halves of the wave were drawn in the same 6px cell, so they crossed into an X and the coloured band worked out about two thirds of a pixel wide, which anti-aliases to nothing. Offsetting the second half by half a cell makes the two diagonals alternate into a continuous wave, and widening the band makes it survive a normal-resolution screen. Flagged words now carry a visible coloured squiggle, the way a spell checker marks a misspelling.

### Changed
- Flagged phrases are underlined with a squiggle rather than a straight line, so the mark reads as a suggestion rather than as part of your formatting. It follows your theme's colours, and a stretch covered by two or more findings gets a denser one.
- The JSON report in `.plumbline/` carries a schema version and leads with the grouped, ranked findings. Every hit is still listed separately underneath, so anything reading the file by position keeps working.
- A flagged phrase shows its rule message in a hover popup, in place of the easy-to-miss native title tooltip. The popup is themed to the active Obsidian theme, so the message is legible on a dark background rather than sitting in a low-contrast light box, it is a readable width, each finding is labeled with its severity, and several findings on the same text read as separate, divided entries. It stays put while the pointer rests on the word. A profile switch or rule toggle refreshes every open editor at once.
- Comments are no longer linted by default: HTML comments, including Annoteca's `<!-- annoteca/... -->` markers, are masked like code and headings, so no rule fires and no metric counts inside comment text. Two settings toggles, both on by default, control this: "Annoteca comments" and "Other HTML comments" are independent, so plain HTML comments can be prose-checked while Annoteca markup stays clean.
- The underline shows where findings overlap. Each stretch of text is underlined in the color of the most severe finding covering it, and a stretch covered by two or more findings gets a double underline, so a spot with several issues is visibly distinct from a single-issue one and you can see where each finding's range begins and ends, instead of one flat mark that hid how many issues cover each part of the text.

## [0.1.0] - 2026-08-31

### Added
- Settings tab with a writing-profile selector and the standard version and links footer.
- Engine groundwork: pure sentence-rhythm statistics (burstiness) with unit tests.
- Engine core: the lint() contract plus the base protected-span pass, so code and headings no longer skew the prose metrics.
- Live rhythm readout: the status bar shows the active note's burstiness as you type, and a command reports the full metrics.
- Rules as data: the base pack's first mechanical rules flag AI-shaped phrasing over prose, skipping code and quotes, and the status bar shows the flag count for the active note.
- Scripture pack: inline quoted verses with a citation are detected and protected, so no rule fires inside scripture, and the scripture pack adds a devotional-register rule.
- Inline diagnostics: flagged phrases are underlined in the editor, with the rule message on hover.
- Findings panel: a side panel lists every flag in the active note, and clicking one jumps to it in the editor. Open it from the ribbon or the command palette.
- More base rules: summative-closer and cinematic-opener, plus a longer flagged-vocabulary list.
- Heuristic cross-sentence rules: negation-assertion (a negation set up only to be corrected) and anaphora (a repeated sentence opening), flagged as suggestions.
- Flags report: a command writes the active note's findings as JSON into the vault's `.plumbline/` folder, so a collaborator on the filesystem reads the same findings the editor shows.
- Vault config: a `.plumbline/config.json` file lets you tune the built-in rules and add your own without touching code, reloadable with a command.
- Scripture usage: citations are parsed and counted per translation, shown in the report and a command. This is the foundation for the copyright verse caps.
- Verbatim scripture check: a command compares each quoted verse against the vault's Bible corpus and reports possible mismatches, skipping verses it cannot find in the corpus.
- Verse caps: a command aggregates distinct quoted verses per translation across the vault and flags any translation over its copyright cap.
- More base rules: hollow-attribution, placeholder-memory, self-rating, trailing-participial (comma-prefixed participles).
- Two more heuristics: rhetorical-pivot (an application question like "But what does this mean for us today?") and demonstrative-opener (a bare "This shows..." with no noun).
- Structural rules over a new paragraph pass: transitional-stacking (a paragraph-initial "However,"), formatting-tells (consecutive bold-led paragraphs), emphasis-fragment (a whole-sentence fragment like "Full stop.").
- Judgment-tier notes (suggestions): personal-claims-vague flags a first-person claim carrying no specific, and anchor-test flags an abstract sentence with no concrete particular.
- AI disclosure: a command reads the active note's `provenance` frontmatter (cold, AI-edited, or AI-drafted) and reports the Amazon KDP disclosure it requires.
