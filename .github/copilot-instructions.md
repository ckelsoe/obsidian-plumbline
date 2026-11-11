# Copilot instructions for obsidian-plumbline

## What this repository is

Plumbline is an [Obsidian](https://obsidian.md) community plugin (TypeScript, esbuild bundle) that flags AI-shaped writing. It also checks prose against the user's own references: term lists, quote sources, scripture translations and name lists. It reads and reports. It never edits a note unless the user clicks a one-click fix.

Key architecture facts:

- `engine/` is the linter core. It takes plain text and config and returns diagnostics. Nothing under `engine/` imports from `obsidian`. Keep it that way, so it stays testable in Node.
- `main.ts` wires lifecycle, commands and settings. Services hold the logic: `analysis-service.ts`, `corpus-service.ts`, `reference-service.ts`. The settings tab lives in `settings-tab.ts`.
- `editor-decorations.ts` draws the CodeMirror 6 underlines and gutter bars. `findings-view.ts` is the side panel.
- `engine/protected-spans.ts` masks text no check may touch: frontmatter, code, headings, Annoteca comments, HTML comments, and pack spans such as scripture quotes and dialogue.
- `api.ts` exposes a read-only API at `app.plugins.getPlugin('plumbline')?.api`, versioned by `PLUMBLINE_API_VERSION` in `api-model.ts`.
- Annoteca is optional. It is reached only at call time through `app.plugins.getPlugin('annoteca')?.api`, gated on its `apiVersion`. Its types live in `annoteca-api.d.ts`.
- User groups, custom checks and config live as JSON under `.plumbline/` in the vault.

## Build, lint, test

```bash
npm run build   # tsc type-check + esbuild bundle
npm run lint    # eslint (zero warnings), prettier --check, submission pre-check, marketplace type-check
npm test        # Vitest
npm run knip    # unused files and exports
npm run type-coverage   # must stay at or above 99%
```

`npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build` must all pass. Prettier owns formatting.

## Hard rules

- Never `eslint-disable` an `obsidianmd/*` rule. Comply instead. Any other allowed disable carries a `-- reason`.
- No `as any`, no non-null assertions (`x!`). Missing types go in `types.d.ts`, not a cast to `Window` or another global.
- No regex lookbehind (`(?<=`, `(?<!`). It is a parse error on iOS before 16.4 and stops the plugin loading. This matters most here, because checks are regexes.
- No bare `moment` imported from `obsidian`. Use `Date` and `Intl`, or `(moment as typeof import('moment'))`.
- No `!important` in `styles.css`, no inline `style` attributes, no `innerHTML` or `outerHTML` writes, no `document.createElement`.
- Popout-safe DOM: use `activeDocument`, `activeWindow` or an element's own document, not the global `document` or `window`.
- No Node built-ins. `isDesktopOnly` is `false` and mobile must keep working.
- UI strings in sentence case. No "command" in command ids or names. Settings headings never contain "settings", "options", "general" or "Plumbline".
- Every value read from `data.json` or `.plumbline/*.json` is validated before use.
- No em dashes in new prose, comments or docs. The README is public: no CI or release internals.

## Plugin-specific pitfalls

- Plumbline never writes Annoteca markers or comment text itself. Promotion of a finding goes through Annoteca's `promote` API.
- A one-click fix must not land inside an Annoteca anchor. `canReplaceRange` in `main.ts` checks this with `overlapsAnchor` from `annoteca-guard.ts`. Keep that check on every replace path.
- All ranges are half-open: `end` is exclusive. Ranges that only touch do not overlap. An off-by-one here blocks a legal fix or lets one land in an anchor.
- Read anchors from the live editor text, not the file on disk. The disk copy is stale while edits are unsaved.
- `engine/finding-key.ts` defines the stable finding key other tools recompute. Any change to its hash, input or key length breaks matching with existing comments.
- Underlines yield to open Annoteca comments (`yield-to-comments.ts`). Treat `addressed` as optional, because older Annoteca builds omit it.
- A new check must not change what another pack flags. Add a known-bad and a known-good test case.
- Never `void` a long-running async command body. Catch, log the original error with `console.error`, and show a `Notice`.
- Every timer in a modal or view is held in a field and cleared on close.
- Tests: Vitest, `vi.*` not `jest.*`. Timing limits go through `timeBudget` in `__tests__/time-budget.ts`, so mutation runs do not fail them. Every assertion must be falsifiable.
