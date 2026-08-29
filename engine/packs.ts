import { Rule } from './types';

// The base pack: universal AI-tell rules that every profile inherits. Genre packs
// (scripture, and later scientific, technical, fiction) add to this. Rules are
// data; adding one is a data edit, not an engine change. See config-model.md.
export const BASE_PACK_ID = 'base';

// A conservative first batch: distinctive phrases with low false-positive risk in
// devotional prose. More rules land incrementally, and the vocabulary lists grow.
export const BASE_RULES: Rule[] = [
	{
		slug: 'reader-direction',
		packId: BASE_PACK_ID,
		category: 'A',
		severity: 'warning',
		message: 'Reader-direction. Cut it and let the sentence do the work.',
		phrases: [
			'read that again',
			'read that carefully',
			'sit with this',
			'sit with that',
			'let that sink in',
			'take a moment',
		],
	},
	{
		slug: 'throat-clearing',
		packId: BASE_PACK_ID,
		category: 'C',
		severity: 'warning',
		message: 'Throat-clearing. Cut it and start with the claim.',
		phrases: [
			"it's important to note",
			"it's important to recognize",
			"it's worth noting",
			'needless to say',
			'it goes without saying',
		],
	},
	{
		slug: 'hedge-stack',
		packId: BASE_PACK_ID,
		category: 'C',
		severity: 'warning',
		message:
			'Stacked hedge. Say what you mean, or say plainly that you are unsure.',
		phrases: [
			'may perhaps',
			'could potentially',
			'it seems likely that',
			'to some extent',
			'in many ways',
			'generally speaking',
		],
	},
	{
		slug: 'flagged-register',
		packId: BASE_PACK_ID,
		category: 'C',
		severity: 'warning',
		message:
			'Flagged register. Use the plainest word that carries the meaning.',
		phrases: [
			'delve',
			'delves',
			'delved',
			'delving',
			'underscore',
			'underscores',
			'underscored',
			'tapestry',
			'intricate',
			'meticulous',
			'showcase',
			'showcases',
			'showcased',
			'showcasing',
		],
	},
];
