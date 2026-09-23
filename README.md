<!-- slop-check: off (names the AI-tell vocabulary the plugin flags, such as delve and leverage, as examples, and uses the mandated fleet-standard Community section wording) -->
# Plumbline

[![CI](https://img.shields.io/github/actions/workflow/status/ckelsoe/obsidian-plumbline/ci.yml?branch=main&label=CI&logo=github)](https://github.com/ckelsoe/obsidian-plumbline/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/actions/workflow/status/ckelsoe/obsidian-plumbline/release.yml?label=Release&logo=github)](https://github.com/ckelsoe/obsidian-plumbline/actions/workflows/release.yml) [![GitHub Downloads](https://img.shields.io/github/downloads/ckelsoe/obsidian-plumbline/total?logo=github&label=Downloads)](https://github.com/ckelsoe/obsidian-plumbline/releases) [![GitHub Stars](https://img.shields.io/github/stars/ckelsoe/obsidian-plumbline?style=flat&logo=github&label=Stars)](https://github.com/ckelsoe/obsidian-plumbline) [![Obsidian](https://img.shields.io/badge/Obsidian-v1.13.0%2B-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md) [![License](https://img.shields.io/github/license/ckelsoe/obsidian-plumbline)](https://github.com/ckelsoe/obsidian-plumbline/blob/main/LICENSE) [![Latest Release](https://img.shields.io/github/v/release/ckelsoe/obsidian-plumbline?label=Latest)](https://github.com/ckelsoe/obsidian-plumbline/releases/latest)

Flag AI-shaped writing and check prose rhythm against your own calibrated baseline.

> **Early release, under active development.** Plumbline is usable but young. Expect rough edges, and expect settings and defaults to change between versions. It flags, it never blocks or edits your prose on its own. If you hit a bug or a wrong flag, please [open an issue](https://github.com/ckelsoe/obsidian-plumbline/issues); early reports shape what gets fixed first.

## What it does

Plumbline reads your prose and points at the places that read as machine-written or mechanically uniform. It only reads. Nothing it does changes a note unless you ask.

- **AI-tell checks.** A library of phrase checks (throat-clearing, hollow attribution, flagged register like "delve" and "leverage", summative closers, and more) plus cross-sentence heuristics (a negation set up only to be corrected, a repeated sentence opening, a bare "This shows...").
- **Prose rhythm.** Burstiness, the variation in sentence length, measured against a calibrated baseline, because human writing varies its sentence length and machine writing tends not to.
- **It skips what is not yours to edit.** Code, headings, and frontmatter are always protected, so no check fires inside them and they do not skew the rhythm number. Quoted scripture is protected too in a group that draws on the scripture pack, such as the Devotional nonfiction starter.
- **Three ways to see a finding.** An inline underline on the phrase, a per-paragraph bar in the gutter colored by severity, and a side panel that groups findings by paragraph and ranks them. A strip beside the scrollbar shows where they sit in the whole note.
- **Groups and a check library.** A group is a named set of checks tuned for a kind of writing. Turn checks on or off, set each one's severity, confidence, and roll-up, and create your own phrase checks. Two read-only starters ship as worked examples to clone.
- **Per-note control.** Frontmatter and inline directives set a note's group, turn individual checks off, or skip a region entirely.
- **Readable on the filesystem.** A command writes each note's findings as JSON into `.plumbline/`, so a collaborator or an assistant working on the files sees the same findings you do.
- **Works with Annoteca.** Turn a finding into a comment thread, and let the underline step aside where a comment already marks the passage. See [docs/annoteca.md](./docs/annoteca.md).

## Scripture tools

Three commands help when a manuscript quotes the Bible. They appear in the command palette when the note you are in is checked with a group that includes the scripture checks, such as the Devotional nonfiction starter. Two work on any vault. The third needs the Bible text in your vault.

- **Show scripture usage for the active note** counts the scripture citations in the note, per translation.
- **Check verse caps across the vault** adds up the distinct verses you quote from each translation, across every note, and flags any translation over its publisher's quotation limit.
- **Check quoted scripture for the active note** compares each quoted verse against the Bible text in your vault and lists quotes that may not match it word for word. This is the one that needs setup.

### Setting up the Bible text

Plumbline does not ship any Bible text. To use "Check quoted scripture":

1. Put the translations you quote in a folder in your vault, in the layout below.
2. Open **Settings > Plumbline > References**, add a reference, and choose that folder. Plumbline checks the folder straight away and shows what it found, such as "2 translations, 66 books, 1,189 chapters", or what to fix.
3. Open **Manage groups**, pick the group you write with, and turn the reference on under **References**. A starter group can use a reference too; you do not need to copy it first.

A group can use several references at once. Until the group has one, the command tells you so rather than guessing. If you rename or move the folder, the reference follows it; if you delete it, the reference shows as Missing.

The folder must use this layout:

```
Bible/                      <- the folder you choose in settings
  KJV/                      <- one folder per translation, named by its code
    01 - Genesis/           <- one folder per book: any prefix, " - ", the book name
      Genesis 1.md          <- one note per chapter: "<book name> <chapter>.md"
      Genesis 2.md
    19 - Psalms/
      Psalms 23.md
  ESV/
    ...
```

- The translation folder name is the code you cite, such as `(Psalm 23:1, KJV)`. Case does not matter.
- A citation of "Psalm" finds a book folder named "Psalms".
- Inside a chapter note, end each verse with an Obsidian block ID of the form `^v<number>`. Frontmatter and a leading `# Heading` are ignored:

```markdown
# Psalms 23

The LORD is my shepherd; I shall not want. ^v1

He maketh me to lie down in green pastures: he leadeth me beside the still waters. ^v2
```

A verse Plumbline cannot find (a missing translation, book, chapter, or verse) is skipped, never reported as a mismatch. Notes inside a reference folder are left out of the verse-cap count, since they are the reference text rather than quotations.

## Installation

Plumbline is **not yet in the Obsidian community store**. While it is in early release, install it one of these two ways. Both need a published release, so if the steps below find nothing, a release has not been cut yet.

### BRAT (recommended while in early release)

BRAT installs and auto-updates a plugin straight from its GitHub releases.

1. Install the **BRAT** plugin from Community plugins.
2. Open BRAT settings and click **Add beta plugin**.
3. Enter `https://github.com/ckelsoe/obsidian-plumbline`.
4. Enable **Plumbline** in Settings, Community plugins.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/ckelsoe/obsidian-plumbline/releases/latest).
2. Create a folder named `plumbline` in your vault's `.obsidian/plugins/` directory.
3. Copy the three files into it.
4. Reload Obsidian and enable **Plumbline** in Settings, Community plugins.

### Community store

Once Plumbline is accepted into the Obsidian community store, you will be able to find it under Settings, Community plugins, Browse, by searching for **Plumbline**. It is not there yet.

## Reporting issues and feedback

This is early software and your reports are how it gets better. A [GitHub issue](https://github.com/ckelsoe/obsidian-plumbline/issues) is the best home for a bug, a false flag, or a request, so it can be tracked. For questions and general discussion there is [Discord](https://discord.gg/gd6tKJDPj4). When you report a wrong flag, the note text that triggered it (or a small excerpt) helps a lot.

## Annoteca integration

Plumbline pairs with [Annoteca](https://obsidian.md/plugins?id=annoteca), a commenting plugin for Obsidian. You can promote a finding into an Annoteca comment to discuss or answer it instead of only silencing it, and Plumbline's underline yields to an open comment so two plugins never mark the same passage at once. Full details in [docs/annoteca.md](./docs/annoteca.md).

## Community

Questions, ideas, and general discussion happen on [Discord](https://discord.gg/gd6tKJDPj4). For anything that needs tracking, a [GitHub issue](https://github.com/ckelsoe/obsidian-plumbline/issues) is still the better home.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, quality gates, and conventions.

## License

MIT. See [LICENSE](./LICENSE).
