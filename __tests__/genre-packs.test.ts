import { lint } from '../engine/lint';
import {
	ALL_PACK_RULES,
	dialogueSpans,
	DIALOGUE_SPAN_KIND,
	OPTIONAL_PACKS,
	PACK_RULES,
} from '../engine/genre-packs';
import {
	ACADEMIC_ID,
	BUSINESS_WRITING_ID,
	FICTION_ID,
	MARKETING_COPY_ID,
	MEMOIR_ID,
	resolveGroup,
	starterGroup,
	STARTER_GROUPS,
	TECHNICAL_WRITING_ID,
} from '../engine/groups';
import { HEURISTIC_RULES } from '../engine/heuristics';

function slugsFor(groupId: string, text: string): string[] {
	const group = starterGroup(groupId);
	if (!group) {
		throw new Error(`missing starter ${groupId}`);
	}
	return lint(text, resolveGroup(group)).diagnostics.map((d) => d.ruleSlug);
}

describe('genre starter groups', () => {
	it('tune only checks that exist, so a typo cannot silently do nothing', () => {
		const known = new Set([
			...ALL_PACK_RULES.map((r) => r.slug),
			...HEURISTIC_RULES.map((r) => r.slug),
		]);
		for (const group of STARTER_GROUPS) {
			for (const slug of Object.keys(group.checks)) {
				expect(`${group.id}:${known.has(slug)}`).toBe(
					`${group.id}:true`,
				);
			}
			for (const packId of group.extends) {
				expect(PACK_RULES[packId]).toBeDefined();
			}
		}
	});

	it('every optional pack in the group editor is a registered pack', () => {
		for (const pack of OPTIONAL_PACKS) {
			expect(PACK_RULES[pack.id]).toBeDefined();
		}
	});

	it('business writing flags jargon and soft openers, and offers the plain word', () => {
		const text = 'Just checking in. Can we touch base about synergy?\n';
		const group = starterGroup(BUSINESS_WRITING_ID);
		if (!group) throw new Error('missing');
		const result = lint(text, resolveGroup(group));
		const slugs = result.diagnostics.map((d) => d.ruleSlug);
		expect(slugs).toContain('soft-opener');
		expect(slugs.filter((s) => s === 'business-jargon')).toHaveLength(2);
		const touch = result.diagnostics.find(
			(d) => text.slice(d.start, d.end).toLowerCase() === 'touch base',
		);
		expect(touch?.fix).toBe('talk');
	});

	it('the business pack does not fire in plain nonfiction', () => {
		expect(
			slugsFor('plain-nonfiction', 'Let us touch base.\n'),
		).not.toContain('business-jargon');
	});

	it('technical writing flags minimizers and future tense, never inside code', () => {
		const text =
			'Simply run the script. The dialog will appear.\n\n```\nsimply\n```\n';
		const slugs = slugsFor(TECHNICAL_WRITING_ID, text);
		expect(slugs.filter((s) => s === 'minimizer')).toHaveLength(1);
		expect(slugs).toContain('future-tense-instruction');
	});

	it('fiction flags narration but leaves quoted dialogue alone', () => {
		const text =
			'Her eyes widened. "My eyes widened and she exclaimed," he said softly.\n';
		const slugs = slugsFor(FICTION_ID, text);
		// One stock phrase in narration; the copy inside the quote is masked.
		expect(slugs.filter((s) => s === 'stock-fiction-phrase')).toHaveLength(
			1,
		);
		expect(slugs).toContain('said-bookism');
	});

	it('a quote character inside inline code does not hide the narration after it', () => {
		const slugs = slugsFor(FICTION_ID, 'Use `"` here. Her eyes widened.\n');
		expect(slugs).toContain('stock-fiction-phrase');
	});

	it('a line of inline code inside a speech does not end the speech', () => {
		const slugs = slugsFor(
			FICTION_ID,
			'"Run\n`npm test`\nuntil her eyes widened." Her jaw tightened.\n',
		);
		expect(slugs.filter((s) => s === 'stock-fiction-phrase')).toHaveLength(
			1,
		);
	});

	it('memoir keeps the stock-phrase check but drops the dialogue-tag check', () => {
		const text = 'Her eyes widened. "Go," he said softly.\n';
		const slugs = slugsFor(MEMOIR_ID, text);
		expect(slugs).toContain('stock-fiction-phrase');
		expect(slugs).not.toContain('said-bookism');
	});

	it('literal uses of common words are not flagged', () => {
		expect(
			slugsFor(MARKETING_COPY_ID, 'Unlock the door with your phone.\n'),
		).not.toContain('hype-word');
		expect(
			slugsFor(TECHNICAL_WRITING_ID, 'Label each cable clearly.\n'),
		).not.toContain('minimizer');
	});

	it('future tense is flagged without a fix, since the verb depends on the subject', () => {
		const group = starterGroup(TECHNICAL_WRITING_ID);
		if (!group) throw new Error('missing');
		const hits = lint(
			'The files will be created.\n',
			resolveGroup(group),
		).diagnostics.filter((d) => d.ruleSlug === 'future-tense-instruction');
		expect(hits).toHaveLength(1);
		expect(hits[0]?.fix).toBeUndefined();
	});

	it('marketing copy flags hype words and stock openers', () => {
		const text =
			"In today's fast-paced world, our seamless tool will unlock your growth.\n";
		const slugs = slugsFor(MARKETING_COPY_ID, text);
		expect(slugs).toContain('marketing-opener');
		expect(slugs.filter((s) => s === 'hype-word')).toHaveLength(2);
	});

	it('academic softens the stacked hedge to a suggestion', () => {
		const group = starterGroup(ACADEMIC_ID);
		if (!group) throw new Error('missing');
		const text = 'The effect could potentially reverse.\n';
		const hedge = lint(text, resolveGroup(group)).diagnostics.find(
			(d) => d.ruleSlug === 'hedge-stack',
		);
		expect(hedge?.severity).toBe('suggestion');
	});
});

describe('dialogueSpans', () => {
	it('covers straight and curly quotes, quotes included', () => {
		const text = 'He said "go" and she said “stay”.';
		expect(
			dialogueSpans(text).map((s) => text.slice(s.start, s.end)),
		).toEqual(['"go"', '“stay”']);
		expect(
			dialogueSpans(text).every((s) => s.kind === DIALOGUE_SPAN_KIND),
		).toBe(true);
	});

	it('an open quote runs to the end of its paragraph, not into the next', () => {
		const text = '"First paragraph of a speech\n\nNarration here.';
		expect(
			dialogueSpans(text).map((s) => text.slice(s.start, s.end)),
		).toEqual(['"First paragraph of a speech']);
	});

	it('a line of only spaces still ends the paragraph', () => {
		const text = '"First part\n \nNarration.';
		expect(
			dialogueSpans(text).map((s) => text.slice(s.start, s.end)),
		).toEqual(['"First part']);
	});

	it('an open quote at the end of the text runs to the end', () => {
		const text = 'Then "trailing';
		expect(
			dialogueSpans(text).map((s) => text.slice(s.start, s.end)),
		).toEqual(['"trailing']);
	});
});
