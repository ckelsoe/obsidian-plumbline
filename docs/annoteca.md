# Plumbline and Annoteca

Plumbline works on its own. Paired with [Annoteca](https://obsidian.md/plugins?id=annoteca), a commenting plugin for Obsidian, a finding stops being a warning you can only silence and becomes a comment you can answer.

Annoteca: [Obsidian community listing](https://obsidian.md/plugins?id=annoteca) and [source on GitHub](https://github.com/ckelsoe/obsidian-annoteca).

## Why pair them

A linter tells you a sentence reads as machine-written. Sometimes you agree and fix it. Sometimes you disagree, and a plain warning gives you nowhere to say so. Annoteca turns the finding into a comment thread anchored to the words, so you, or a collaborator on the file, can record the decision instead of losing it. An assistant reading the note on the filesystem sees the same thread.

## What the integration does

### Promote a finding to a comment

From a finding's hover, or from the "Add comments for the findings in this note" command, Plumbline hands the flagged passage to Annoteca as a comment. The comment is anchored to the exact words and filed under the "Prose check" category. It records that Plumbline created it, so promoting the same finding twice does nothing and you never end up with two comments for one flag.

The two paths differ in one way. Promoting a single finding from its hover opens a dialog: your words lead the comment and the finding follows as context, and you can pick another category from your own Annoteca list before it is created. The command adds every finding in the note at once, under the default category, with no dialog.

### The underline yields to a comment

By default Plumbline's inline underline steps aside where an open Annoteca comment already marks the same words, so two plugins do not underline one passage at once. A comment you have resolved does not hide the underline, and neither does one with an edit waiting on you, because that prose is back in play. The gutter bar and the findings panel always show everything, so nothing is hidden, only the inline mark.

You control this with the "underline flagged phrases" setting. Yield to comments is the default; you can also set it to always or never.

### A read-only view for companions

Plumbline exposes its findings through a small read-only API, so a companion plugin like Annoteca can ask for a note's findings without building its own copy of the linter. It only reads. Nothing another plugin does through it can change a note or a setting.

## Requirements

- Install [Annoteca](https://obsidian.md/plugins?id=annoteca) from the community store.
- Plumbline checks Annoteca's API version at call time and steps back to unpaired behaviour if it is too old, so an older Annoteca never breaks Plumbline.

## When Annoteca is not installed

Plumbline is fully usable on its own. With no Annoteca present the promote action is simply absent and the underline never yields. Nothing else changes.

## Early release

Both plugins are under active development and this pairing may change between versions. If the promote action is missing when you expect it, or the underline does not yield, please [open an issue](https://github.com/ckelsoe/obsidian-plumbline/issues) with what you saw.
