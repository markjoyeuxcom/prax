// Editor writing actions (Tier-3 #7) — pure prompt builders for the AI writing
// helpers in the document editor: draft a body from a title, summarize, rewrite
// for clarity, and turn notes into a runnable checklist. The route does the IO
// (chat call); these stay pure + testable. Output is applied to the editor
// buffer for the human to review + save (a user-assisted edit, not auto-saved).

// `input` is 'title' (draft works from the doc title) or 'text' (the selection
// or whole body). The frontend gates the menu on a configured chat model.
export const WRITING_ACTIONS = {
  draft: { label: 'Draft from title', input: 'title', verb: 'Replace document' },
  summarize: { label: 'Summarize', input: 'text', verb: 'Insert summary at top' },
  rewrite: { label: 'Rewrite for clarity', input: 'text', verb: 'Replace' },
  checklist: { label: 'Notes → checklist', input: 'text', verb: 'Replace' },
};

export function isWritingAction(action) {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(WRITING_ACTIONS, action);
}

const DRAFT_SYSTEM = [
  'You are a platform engineer / SRE drafting a Markdown document from its title.',
  'Write a useful first draft: a one-line purpose, then relevant "## " sections.',
  'If the title implies a runbook, make each actionable step a "- [ ] " checkbox with exact commands in backticks, and include a Rollback section.',
  'Never invent environment-specific values (hostnames, credentials, URLs) — use angle-bracket placeholders like <PRIMARY_HOST>.',
  'Be concise and practical; this is a draft for a human to review and verify.',
  'Output ONLY the Markdown body — no code fence around the whole thing, no preamble, no commentary.',
].join(' ');

const SUMMARIZE_SYSTEM = [
  'You summarize an SRE/platform document into a tight TL;DR.',
  'Capture the key points, decisions, or steps in 2–4 sentences or a few bullets, in Markdown.',
  'Use ONLY information present in the text; do not add, infer, or invent anything.',
  'Output ONLY the summary — no heading like "Summary", no code fence, no commentary.',
].join(' ');

const REWRITE_SYSTEM = [
  'You rewrite Markdown to be clearer, tighter, and well-structured while PRESERVING its meaning.',
  'Keep every fact, command, threshold, and Markdown construct (headings, lists, "- [ ]" checkboxes, code blocks, links) intact.',
  'Do not add or remove information, and do not invent commands, values, or steps.',
  'Output ONLY the rewritten Markdown — no code fence around the whole thing, no commentary.',
].join(' ');

const CHECKLIST_SYSTEM = [
  'You convert notes into an actionable Markdown checklist.',
  'Emit one "- [ ] " item per discrete step or action, in order, in imperative voice, with exact commands in backticks.',
  'Stay faithful to the notes — do not invent steps or values, and do not drop any.',
  'Output ONLY the checklist lines — no heading, no code fence, no commentary.',
].join(' ');

const SYSTEMS = { draft: DRAFT_SYSTEM, summarize: SUMMARIZE_SYSTEM, rewrite: REWRITE_SYSTEM, checklist: CHECKLIST_SYSTEM };

export function buildWritingMessages(action, { text = '', title = '', documentType = '' } = {}) {
  const system = SYSTEMS[action];
  if (!system) throw new Error(`unknown writing action: ${action}`);
  let user;
  if (action === 'draft') {
    const t = String(title ?? '').trim() || 'Untitled';
    user = `Title: "${t}"${documentType ? ` (a ${documentType})` : ''}\n\nWrite the document body.`;
  } else {
    const body = String(text ?? '').trim();
    const noun = action === 'checklist' ? 'notes' : 'document';
    user = `${action === 'checklist' ? 'Convert these notes to a checklist' : action === 'summarize' ? 'Summarize this document' : 'Rewrite this Markdown'}:\n\n${body || `(empty ${noun})`}`;
  }
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Models sometimes wrap the whole answer in a ```/```markdown fence despite the
// instruction; strip a single outer fence so the applied text is clean Markdown.
// Only unwrap a bare or markdown-tagged fence — a language-tagged block
// (```bash, ```sql, …) may legitimately be the entire intended output, so leave
// it intact rather than silently dropping its fence.
export function stripCodeFence(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/^```([a-zA-Z]*)\n([\s\S]*?)\n?```$/);
  if (m && ['', 'markdown', 'md'].includes(m[1].toLowerCase())) return m[2].trim();
  return s;
}
