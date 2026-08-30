// KDP AI disclosure (ruleset rule 28). Amazon's categories depend on how a
// chapter was made, recorded in a per-note `provenance` frontmatter field. The
// disclosure goes to Amazon at title setup, never shown to readers.
//
//   cold       written cold                  -> neither category, no disclosure
//   ai-edited  yours, AI-edited              -> AI-assisted, no disclosure
//   ai-drafted AI-drafted then revised       -> AI-generated, DISCLOSE

export interface KdpGuidance {
	category: string;
	disclose: boolean;
	note: string;
}

export function kdpDisclosure(provenance: string): KdpGuidance | null {
	switch (provenance.trim().toLowerCase()) {
		case 'cold':
		case 'written-cold':
			return {
				category: 'neither',
				disclose: false,
				note: 'Written cold. No Amazon AI category, no disclosure.',
			};
		case 'ai-edited':
		case 'edited':
			return {
				category: 'AI-assisted',
				disclose: false,
				note: 'Yours, AI-edited. AI-assisted category, no disclosure to Amazon.',
			};
		case 'ai-drafted':
		case 'drafted':
			return {
				category: 'AI-generated',
				disclose: true,
				note: 'AI-drafted then revised. AI-generated category; disclose to Amazon at title setup.',
			};
		default:
			return null;
	}
}
