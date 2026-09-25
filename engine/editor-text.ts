// A note's text as the editor holds it: every line break (\r\n, a lone \r, or
// \n) is one \n. Positions Plumbline hands out (the API's findingsFor, report
// offsets and line numbers) count characters in this text, so a note read from
// disk is converted before it is linted. Without it, a note saved with CRLF
// endings gets offsets one too high per line break above them, and a lone-CR
// note reads as a single line.
//
// Matches Annoteca's toEditorText; kept local because Plumbline does not depend
// on Annoteca.
export function toEditorText(raw: string): string {
	return raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw;
}
