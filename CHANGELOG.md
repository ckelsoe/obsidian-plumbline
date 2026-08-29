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
