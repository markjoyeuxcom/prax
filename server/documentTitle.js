// A title is ONE line of plain text. Titles are rendered inline into
// agent-facing Markdown (context packs, the Ask answer context, the assistant
// snapshot) right beside trust labels, so a line break would let a title open
// its own heading and borrow a "verified" label it never earned.
//
// Any run of whitespace that contains a line break or other control character
// collapses to one space. Ordinary spaces are left alone, so exact-title
// matching (upsert-by-title) is unchanged for every title that was already a
// single line. Migration 0035 applies the same rule to stored titles.
const CONTROL_RUN_RE = /[\s\p{Cc}]*[\p{Cc}\u2028\u2029][\s\p{Cc}]*/gu;

export function normalizeTitle(value) {
  return String(value ?? '').replace(CONTROL_RUN_RE, ' ').trim();
}
