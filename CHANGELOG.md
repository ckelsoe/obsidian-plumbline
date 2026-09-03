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

### Changed
- Inline diagnostics now run through CodeMirror's lint system, so a flagged phrase shows an immediate hover tooltip with the rule message and a gutter marker, in place of the easy-to-miss native title tooltip. The underline and the tooltip are themed to the active Obsidian theme, so the marker is visible and the message is legible on a dark background rather than a faint mark and a low-contrast light box. The tooltip is a readable width, each finding is labeled with its severity, and when several findings land on the same text they are shown as separate, divided entries. A profile switch or rule toggle re-lints every open editor at once.
- Comments are no longer linted by default: HTML comments, including Annoteca's `<!-- annoteca/... -->` markers, are masked like code and headings, so no rule fires and no metric counts inside comment text. Two settings toggles, both on by default, control this: "Annoteca comments" and "Other HTML comments" are independent, so plain HTML comments can be prose-checked while Annoteca markup stays clean.
- Overlapping findings show as stacked underlines, one line per finding colored by severity, so a spot with two issues shows two lines and where a range ends its line drops away, instead of one flat mark that hid how many issues cover each part of the text.
