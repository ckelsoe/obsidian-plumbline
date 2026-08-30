import { kdpDisclosure } from '../engine/kdp';

describe('kdpDisclosure', () => {
	it('written cold needs no disclosure', () => {
		const guidance = kdpDisclosure('cold');
		expect(guidance?.category).toBe('neither');
		expect(guidance?.disclose).toBe(false);
	});

	it('AI-edited is AI-assisted with no disclosure', () => {
		const guidance = kdpDisclosure('ai-edited');
		expect(guidance?.category).toBe('AI-assisted');
		expect(guidance?.disclose).toBe(false);
	});

	it('AI-drafted must be disclosed', () => {
		const guidance = kdpDisclosure('AI-Drafted');
		expect(guidance?.category).toBe('AI-generated');
		expect(guidance?.disclose).toBe(true);
	});

	it('returns null for an unknown value', () => {
		expect(kdpDisclosure('whatever')).toBeNull();
	});
});
