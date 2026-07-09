// Pure helpers for auto-generating a post-mortem from a runbook run's chronicle.
// All IO (fetching the run, the chat call, creating the doc) lives in the route;
// these turn a run + its steps into a factual summary, an LLM prompt, and a
// deterministic fallback draft.

function parse(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// "Xm" / "Xh Ym" between two ISO timestamps; '' if unparseable or negative.
export function elapsed(startIso, endIso) {
  const start = parse(startIso);
  const end = parse(endIso);
  if (start == null || end == null || end < start) return '';
  const mins = Math.round((end - start) / 60000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function postMortemTitle(run, docTitle = '') {
  const name = docTitle || run?.title || 'Runbook';
  const date = String(run?.startedAt || '').slice(0, 10); // YYYY-MM-DD, deterministic
  return `Post-mortem: ${name}${date ? ` — ${date}` : ''}`;
}

// A factual, deterministic chronicle of the run: header stats + a per-step
// timeline (done/pending, time, actor, gap since the previous checked step).
// This is both the LLM's source material and the backbone of the fallback draft.
export function buildRunSummary(run, docTitle = '') {
  if (!run) return '';
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const done = steps.filter((s) => s.checkedAt).length;
  const lines = [
    `Runbook: ${docTitle || run.title || 'Runbook'}`,
    `Status: ${run.status}`,
    `Started: ${run.startedAt || '(unknown)'} by ${run.startedBy || 'user'}`,
  ];
  if (run.finishedAt) lines.push(`Finished: ${run.finishedAt}`);
  const dur = elapsed(run.startedAt, run.finishedAt);
  if (dur) lines.push(`Duration: ${dur}`);
  lines.push(`Steps completed: ${done} of ${steps.length}`);
  lines.push('', 'Timeline:');
  // Order the executed steps by when they were checked (steps can be ticked out
  // of position), and note the gap between consecutive checks.
  const checked = steps.filter((s) => s.checkedAt).slice().sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
  let prev = run.startedAt;
  for (const step of checked) {
    const gap = elapsed(prev, step.checkedAt);
    lines.push(`- [done] ${step.text} — ${step.checkedAt} (by ${step.checkedBy || 'user'}${gap ? `, +${gap}` : ''})`);
    prev = step.checkedAt;
  }
  for (const step of steps.filter((s) => !s.checkedAt)) {
    lines.push(`- [not done] ${step.text}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  'You are an SRE writing an incident post-mortem from a runbook run chronicle.',
  'Use ONLY the facts in the chronicle — timestamps, step outcomes, actors, duration. Do not invent causes, impact, or details not present.',
  'Write in Markdown with these sections: ## Summary, ## Timeline, ## What happened, ## Impact, ## Follow-ups.',
  'In Timeline, reproduce the step order and times faithfully. Where the chronicle lacks information (root cause, customer impact), write "Not recorded — needs input" rather than guessing.',
  'Be concise and factual; this is a draft for a human to review and verify.',
].join(' ');

export function buildPostMortemMessages(run, summary, docTitle = '') {
  const title = docTitle || run?.title || 'Runbook';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Write a post-mortem for this runbook run.\n\nRUN: ${title}\n\nCHRONICLE:\n\n${String(summary || '').trim() || '(no chronicle)'}` },
  ];
}

// Deterministic post-mortem draft used when no chat model is configured (or
// generation fails): the factual chronicle framed as a post-mortem skeleton with
// prompts for the human to fill the narrative sections.
export function fallbackPostMortem(run, summary, docTitle = '') {
  const title = docTitle || run?.title || 'Runbook';
  return [
    `# Post-mortem: ${title}`,
    '',
    '> Draft generated from the run chronicle. No AI model configured — fill in the narrative sections below.',
    '',
    '## Summary',
    '_Not recorded — needs input._',
    '',
    '## Timeline',
    '',
    '```',
    String(summary || '').trim(),
    '```',
    '',
    '## What happened',
    '_Not recorded — needs input._',
    '',
    '## Impact',
    '_Not recorded — needs input._',
    '',
    '## Follow-ups',
    '- [ ] _Add follow-up actions._',
    '',
  ].join('\n');
}
