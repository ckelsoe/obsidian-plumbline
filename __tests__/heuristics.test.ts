import { applyHeuristics } from '../engine/heuristics';
import { splitSentencesWithOffsets } from '../engine/sentences';

function run(text: string) {
	return applyHeuristics(text, splitSentencesWithOffsets(text));
}

describe('applyHeuristics disabled set', () => {
	it('skips a heuristic whose slug is disabled', () => {
		const text = 'It is not an emotion. It is a settled trust.';
		const sentences = splitSentencesWithOffsets(text);
		const slugs = applyHeuristics(
			text,
			sentences,
			new Set(['negation-assertion']),
		).map((d) => d.ruleSlug);
		expect(slugs).not.toContain('negation-assertion');
	});
});

describe('negation-assertion', () => {
	it('flags a negation set up to be corrected', () => {
		const text = 'It is not an emotion. It is a settled trust.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'negation-assertion',
		);
	});

	it('does not flag a lone negation with no following sentence', () => {
		expect(
			run('It is not an emotion.').map((d) => d.ruleSlug),
		).not.toContain('negation-assertion');
	});
});

describe('anaphora', () => {
	it('flags a repeated opening across adjacent sentences', () => {
		const text =
			'In the beginning God created. In the beginning was the Word.';
		const diag = run(text).find((d) => d.ruleSlug === 'anaphora');
		expect(diag).toBeDefined();
		if (diag) {
			expect(text.slice(diag.start, diag.end)).toBe('In the');
		}
	});

	it('does not flag differing openings', () => {
		expect(
			run('The Lord is good. The people rejoiced.').map(
				(d) => d.ruleSlug,
			),
		).not.toContain('anaphora');
	});
});

describe('rhetorical-pivot', () => {
	it('flags a rhetorical application question', () => {
		expect(
			run('But what does this mean for us today?').map((d) => d.ruleSlug),
		).toContain('rhetorical-pivot');
	});

	it('does not flag a plain question of fact', () => {
		expect(
			run('He asked for bread and fish.').map((d) => d.ruleSlug),
		).not.toContain('rhetorical-pivot');
	});
});

describe('demonstrative-opener', () => {
	it('flags a bare demonstrative opener', () => {
		expect(
			run('This shows the mercy of God.').map((d) => d.ruleSlug),
		).toContain('demonstrative-opener');
	});

	it('does not flag a demonstrative with a noun attached', () => {
		expect(
			run('This adoption changes everything.').map((d) => d.ruleSlug),
		).not.toContain('demonstrative-opener');
	});
});

describe('transitional-stacking', () => {
	it('flags a paragraph-initial transition', () => {
		const text = 'He wrote the letter.\n\nHowever, the church ignored it.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'transitional-stacking',
		);
	});

	it('does not flag a mid-sentence however', () => {
		expect(
			run('The point stands, however, in a smaller way.').map(
				(d) => d.ruleSlug,
			),
		).not.toContain('transitional-stacking');
	});
});

describe('formatting-tells', () => {
	it('flags consecutive bold-led paragraphs', () => {
		const text =
			'**First point.** It matters.\n\n**Second.** It also does.';
		expect(run(text).map((d) => d.ruleSlug)).toContain('formatting-tells');
	});
});

describe('emphasis-fragment', () => {
	it('flags a whole-sentence fragment', () => {
		expect(
			run('The verse is clear. Full stop.').map((d) => d.ruleSlug),
		).toContain('emphasis-fragment');
	});

	it('does not flag a normal short sentence', () => {
		expect(run('He wept.').map((d) => d.ruleSlug)).not.toContain(
			'emphasis-fragment',
		);
	});
});

describe('personal-claims-vague', () => {
	it('flags a first-person claim with no specific', () => {
		const text =
			'I grew up in places where belief was measured by feeling.';
		expect(run(text).map((d) => d.ruleSlug)).toContain(
			'personal-claims-vague',
		);
	});

	it('does not flag when a proper noun anchors it', () => {
		const text =
			'I grew up in Dallas where belief was measured by feeling.';
		expect(run(text).map((d) => d.ruleSlug)).not.toContain(
			'personal-claims-vague',
		);
	});
});

describe('anchor-test', () => {
	it('flags an abstract sentence with no concrete anchor', () => {
		const text =
			'The path of transformation is devotion, intention, and submission.';
		expect(run(text).map((d) => d.ruleSlug)).toContain('anchor-test');
	});
});

describe('applyHeuristics', () => {
	it('has no diagnostics for plain prose', () => {
		expect(run('He kept the promise he made in the spring.')).toEqual([]);
	});
});

describe('repeated-word', () => {
	const hits = (text: string) =>
		run(text)
			.filter((d) => d.ruleSlug === 'repeated-word')
			.map((d) => ({ text: text.slice(d.start, d.end), fix: d.fix }));

	it('flags a doubled word and offers the first copy as the fix', () => {
		expect(hits('We went to the the store.')).toEqual([
			{ text: 'the the', fix: 'the' },
		]);
	});

	it('catches the copies across a line break, the classic slip', () => {
		expect(hits('We went to the\nthe store.')).toEqual([
			{ text: 'the\nthe', fix: 'the' },
		]);
	});

	it('catches a list continuation line', () => {
		expect(hits('- We went to the\n  the store.')).toEqual([
			{ text: 'the\n  the', fix: 'the' },
		]);
	});

	it('matches case-insensitively and keeps the first copy as written', () => {
		expect(hits('The the store was shut.')).toEqual([
			{ text: 'The the', fix: 'The' },
		]);
	});

	it('gives one finding for a tripled word, not two overlapping ones', () => {
		expect(hits('a b the the the c')).toEqual([
			{ text: 'the the', fix: 'the' },
		]);
	});

	it('does not flag words correctly doubled in English', () => {
		expect(hits('By noon he had had enough.')).toEqual([]);
		expect(hits('She said that that was fine.')).toEqual([]);
		expect(hits('What it is is plain.')).toEqual([]);
	});

	it('does not flag a place name with both copies capitalized', () => {
		expect(hits('They drove to Walla Walla.')).toEqual([]);
	});

	it('does not flag across punctuation or a paragraph break', () => {
		expect(hits('He left. Left for good.')).toEqual([]);
		expect(hits('Go, go home.')).toEqual([]);
		expect(hits('It ended with the\n\nthe next one began.')).toEqual([]);
	});

	it('does not flag a word inside a longer one', () => {
		expect(hits('Read the theme.')).toEqual([]);
		// "voil" in "voilà" is not a word, so it cannot pair with anything.
		expect(hits('voil voilà')).toEqual([]);
	});

	it('flags a doubled "I", which is never a place name', () => {
		expect(hits('Then I I went home.')).toEqual([
			{ text: 'I I', fix: 'I' },
		]);
	});

	it('catches a doubled accented word whole', () => {
		expect(hits('Meet at the café café on Main.')).toEqual([
			{ text: 'café café', fix: 'café' },
		]);
	});

	it('does not flag a doubled accented name', () => {
		expect(hits('They flew to Éire Éire.')).toEqual([]);
	});

	// Deseret letters are two UTF-16 units each; the edge and capital checks
	// must read whole characters.
	it('reads letters outside the Basic Multilingual Plane whole', () => {
		expect(hits('\u{10428} \u{10428}2')).toEqual([]);
		expect(hits('\u{10400}\u{10428} \u{10400}\u{10428}')).toEqual([]);
		expect(hits('a \u{10428}\u{10429} \u{10428}\u{10429} b')).toEqual([
			{
				text: '\u{10428}\u{10429} \u{10428}\u{10429}',
				fix: '\u{10428}\u{10429}',
			},
		]);
	});

	it('does not flag across a paragraph break in an old Mac file', () => {
		expect(hits('It ended with the\r\rthe next one.')).toEqual([]);
	});

	it('reads a contraction as one word, with either apostrophe', () => {
		expect(hits("The can can't be opened.")).toEqual([]);
		expect(hits('The can can’t be opened.')).toEqual([]);
	});

	it('does not flag an emphatic "do do"', () => {
		expect(hits('I do do the dishes.')).toEqual([]);
	});

	it('catches the copies across a Windows line break', () => {
		expect(hits('We went to the\r\nthe store.')).toEqual([
			{ text: 'the\r\nthe', fix: 'the' },
		]);
	});

	// Protected text reaches the heuristics masked to spaces, so only the span
	// list can tell a masked gap from typed whitespace.
	it('does not pair copies across a protected span', () => {
		const text = 'the\n   the';
		const masked = applyHeuristics(
			text,
			splitSentencesWithOffsets(text),
			new Set(),
			{},
			[{ start: 4, end: 7 }],
		).filter((d) => d.ruleSlug === 'repeated-word');
		expect(masked).toEqual([]);
		// The same text with no span is typed indentation, and is flagged.
		expect(hits(text)).toEqual([{ text, fix: 'the' }]);
	});
});
