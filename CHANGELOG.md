# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Project scaffold from the standard template: build, CI, release, and scorecard tooling.
- Settings tab with a writing-profile selector and the standard version and links footer.
- Engine groundwork: pure sentence-rhythm statistics (burstiness) with unit tests.
- Engine core: the lint() contract plus the base protected-span pass, so code and headings no longer skew the prose metrics.
- Live rhythm readout: the status bar shows the active note's burstiness as you type, and a command reports the full metrics.
- Rules as data: the base pack's first mechanical rules flag AI-shaped phrasing over prose, skipping code and quotes, and the status bar shows the flag count for the active note.
- Scripture pack: inline quoted verses with a citation are detected and protected, so no rule fires inside scripture, and a devotional-register rule is added for the scripture profile.
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
- Rule toggles in settings: the settings tab lists every built-in rule for the active profile, both the mechanical phrase rules and the cross-sentence heuristics, each with an on/off switch, so the ruleset is visible and adjustable without hand-editing `.plumbline/config.json`. A toggle rewrites only the disabled list; the file is re-read first, so any hand-authored overrides, custom rules, or edits made since load are preserved.

### Added
- The findings panel is organised by paragraph. Each paragraph you have flagged gets its own section with a one-line count, the rules worth acting on listed under it in order, and suggestions collapsed into a single row you can open. A rule that fired several times in a paragraph shows the count and expands to every place it fired, so you can step through them instead of only jumping to the first. Long lists cap at 25 rows with a button that says how many more there are.
- Findings are grouped and ranked. A rule that fires again and again through a chapter now reports as one row carrying every place it fired, instead of one row per hit, and the list is ordered by how much each rule is worth your attention rather than by where it appears. Measured over 25 real chapters: 297 raw hits became 93 rows, and the worst chapter went from 24 hits to 5 rows. The ordering weighs how severe a rule is, how often it fired, and how often that kind of rule is right, so a single misquoted verse outranks fifteen notes about vague phrasing. Both the grouping threshold and the per-rule weighting are tunable in `.plumbline/config.json`.
- A severity bar in the editor gutter. Each paragraph carrying findings gets a colored bar beside it, in the color of the worst finding in that paragraph, and the bar is as tall as the paragraph, so a long stretch of flagged prose reads as a long bar. Hovering it gives a one-line count, for example "35 findings in this paragraph: 27 warnings, 8 suggestions". The bar points at a paragraph, never at a phrase, which is what the editor's gutter can address; the underline and the findings panel are where a phrase is located.
- Per-note scoping. A note can pick its own writing profile, turn individual rules off, or opt out of checking entirely, through `plumbline-profile` and `plumbline-disabled-rules` in its frontmatter (`plumbline-disabled-rules: all` opts the whole note out). Inside a note, `<!-- plumbline: off -->` and `<!-- plumbline: on -->` bracket a stretch nothing should fire on, and `<!-- plumbline-disable -->` / `<!-- plumbline-enable -->` do the same thing if you already have that habit from other plugins. A skipped stretch is left out of the rhythm metrics too, so burstiness is measured over the prose you are actually writing rather than over a block quote you excluded. `<!-- plumbline: disable <rule> -->`, `<!-- plumbline: enable <rule> -->` and `<!-- plumbline: profile <id> -->` do the same as the frontmatter keys, and an unclosed `off` runs to the end of the note. The decision is made in one place, so the editor, the JSON report and every command scope a note the same way.

### Changed
- Flagged phrases are underlined with a squiggle rather than a straight line, so the mark reads as a suggestion rather than as part of your formatting. It follows your theme's colours, and a stretch covered by two or more findings gets a denser one.
- The JSON report in `.plumbline/` carries a schema version and leads with the grouped, ranked findings. Every hit is still listed separately underneath, so anything reading the file by position keeps working.
- A flagged phrase shows its rule message in a hover popup, in place of the easy-to-miss native title tooltip. The popup is themed to the active Obsidian theme, so the message is legible on a dark background rather than sitting in a low-contrast light box, it is a readable width, each finding is labeled with its severity, and several findings on the same text read as separate, divided entries. It stays put while the pointer rests on the word. A profile switch or rule toggle refreshes every open editor at once.
- Comments are no longer linted by default: HTML comments, including Annoteca's `<!-- annoteca/... -->` markers, are masked like code and headings, so no rule fires and no metric counts inside comment text. Two settings toggles, both on by default, control this: "Annoteca comments" and "Other HTML comments" are independent, so plain HTML comments can be prose-checked while Annoteca markup stays clean.
- The underline shows where findings overlap. Each stretch of text is underlined in the color of the most severe finding covering it, and a stretch covered by two or more findings gets a double underline, so a spot with several issues is visibly distinct from a single-issue one and you can see where each finding's range begins and ends, instead of one flat mark that hid how many issues cover each part of the text.
