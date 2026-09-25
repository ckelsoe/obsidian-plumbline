<!-- slop-check: off (shows curly quote and ellipsis characters as matching examples, and the AI-tell words a term list might hold) -->
# References: format and matching rules

A reference is a note or folder in your vault that Plumbline checks your prose against. The [README](../README.md#check-your-prose-against-your-own-material) explains what references are for and how to add one. This page is the detail for each type: what the note or folder must look like, and exactly what gets flagged.

Every type follows the same rules for setup and upkeep:

- Plumbline checks a reference the moment you choose its note or folder, and shows what it found ("42 terms, 30 with a replacement.", "12 names (3 aliases).") or what to fix.
- If you rename or move the note or folder, the reference follows it. If you delete it, the reference shows as Missing and is skipped quietly.
- A group can use several references, including several of one type.
- When two references disagree, you see every suggestion, each labelled with the reference it came from, and you choose. Plumbline never picks for you. The same term or name in two references is one finding naming both.
- Any finding can be turned off for a single note from its hover.

## Term list

A note of words and phrases to avoid, and what to use instead. Type: **Term list (voice or style file)**.

Plumbline reads two things from the note and ignores everything else (headings, prose, frontmatter).

**Tables** with a column of terms to avoid and, optionally, a column of what to use. Columns are recognised by their heading, in either order. A column to avoid is headed with words like "Do not use", "Avoid", "Jargon", or "Banned"; a column to use with words like "Use instead", "Plain replacement", "Preferred", or "Product name". A cell can list several terms separated by commas.

```markdown
| Product name | Do not use              |
|--------------|-------------------------|
| Plumbline    | PlumbLine, Plumb Line   |

| Avoid        | Use instead |
|--------------|-------------|
| utilize      | use         |
| leverage     | use         |
```

**Bullets that open with a quoted phrase.** These are flagged with no replacement. A bullet that does not start with a quote is treated as guidance and skipped.

```markdown
- "Here's the thing:"
- "Let that sink in."
- "The real [X] is"
```

- Matching ignores case, except when a term differs from its replacement only in case. "PlumbLine" is then flagged and "Plumbline" is not.
- A straight apostrophe in the list also matches a curly one in your prose.
- A placeholder in square brackets matches any one word in the middle of a phrase ("The real [X] is" flags "The real problem is"), and is dropped at the end ("Here's what [X]" flags "Here's what").

## Quote source (any notes)

A folder of source notes: interviews, transcripts, hearings, statutes, documents. One note per source; subfolders are fine. Type: **Quote source (any notes)**.

Cite a quote with a wikilink to its source note, straight after the closing quote mark, or in a footnote whose text opens with the link. A quote that is not in the note it cites is underlined as you write.

```markdown
Dana said "we shipped late because QA was short" ([[2024-03-02 Interview]]).

Dana said "we shipped late"[^1].

[^1]: [[2024-03-02 Interview]], 12:30

> We shipped late because QA was short.
> ([[2024-03-02 Interview]])
```

- Quotes can use double or single marks, straight or curly. Matching ignores case, the style of quote marks, line breaks, and a comma or full stop moved inside the closing quote mark. Formatting in the source note (bold, italics, links, blockquote marks, block IDs) is ignored too.
- An ellipsis (`...` or `…`) or a bracketed insertion such as `[the team]` marks a gap. The words either side must each appear in the note, in order.
- A link to a note outside every source folder the group uses is not checked.
- If two source folders hold a note with the same name, a quote passes when it is in either one. When it is in neither, the finding names both notes and their references.
- Turn the check off for a note with `plumbline-disabled-rules: [quote-not-in-source]` in its frontmatter.

## Quote source (scripture layout)

Bible translations laid out by book and chapter, for checking quoted verses word for word. Type: **Quote source (scripture layout)**, which is the type a new reference starts as. Plumbline does not ship any Bible text.

```
Bible/                      <- the folder you choose
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

Three commands work with scripture. They appear in the command palette when the note's group includes the scripture checks, such as the Devotional nonfiction starter:

- **Show scripture usage for the active note** counts the note's scripture citations, per translation.
- **Check verse caps across the vault** adds up the distinct verses you quote from each translation, across every note, and flags any translation over its publisher's quotation limit.
- **Check quoted scripture for the active note** compares each quoted verse against this reference and lists quotes that may not match word for word. It is the only one of the three that needs the reference.

## Name list

A folder of notes about the people and places in a story, one note each. Type: **Name list (people and places)**.

The note's file name is the name: `Catherine.md` gives "Catherine". A heading inside the note is not read. Other spellings you use on purpose go in the note's `aliases` frontmatter and count as names too.

```markdown
---
aliases: [Kate, Cat]
---
Catherine's notes: age, family, first appearance.
```

- A capitalised word is flagged when it is one letter off a name: a letter changed, added, dropped, or two letters swapped. Names of eight or more letters allow two.
- Names and words under four letters are never checked, and neither are words in capitals throughout, such as acronyms.
- A name or alias exactly as listed is never flagged, whatever its case or apostrophe style ("O'Brien" and "O’Brien" are the same name), and neither is a family named in the plural ("the Bennets").
- A name of several words ("Mary Jane") is matched against capitalised words separated by single spaces.
- If a word is close to two names, the hover offers both, each with the list it came from.
- A short name can sit one letter from an ordinary word ("Mary" and "Many"). Turn the check off for a note with `plumbline-disabled-rules: [name-near-miss]` in its frontmatter.
