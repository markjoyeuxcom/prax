// Pure helpers for generating a runbook from an alert/incident description.
// The route does the IO (chat call + doc creation); these build the prompt and
// parse the model's Markdown into a { title, body } for the new document.

const SYSTEM_PROMPT = [
  'You are an experienced SRE writing an operational runbook from an alert or incident description.',
  'Produce a clear, safe, executable runbook in Markdown.',
  'Start with a single "# Title" line naming the runbook.',
  'Follow with a one-line purpose, then "## " sections such as Pre-flight, Mitigation, Verify, and Rollback.',
  'Every actionable step MUST be a "- [ ] " checkbox line so it can be executed and tracked; put exact commands in backticks.',
  'Call out destructive steps explicitly and always include a Rollback section.',
  'Do not invent environment-specific values (hostnames, credentials, URLs) — use angle-bracket placeholders like <PRIMARY_HOST>.',
  'Be concise and practical; this is a draft for a human to review and verify.',
].join(' ');

export function buildRunbookMessages(description) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Write a runbook for this situation:\n\n${String(description ?? '').trim() || '(no description provided)'}` },
  ];
}

// A title derived from the description, for when the model didn't emit an H1.
export function runbookTitleFromDescription(description = '') {
  const first = String(description ?? '').replace(/\s+/g, ' ').trim().split(/[.\n]/)[0].slice(0, 80).trim();
  return first ? `Runbook: ${first}` : 'Generated runbook';
}

// Split the model's Markdown into the doc's title (the first "# " heading, or a
// description-derived fallback) and body (the full Markdown, kept intact).
export function parseGeneratedRunbook(text, description = '') {
  const body = String(text ?? '').trim();
  const h1 = body.match(/^#\s+(.+)$/m); // "# Title" — not "## Section"
  const title = ((h1 ? h1[1] : runbookTitleFromDescription(description)).trim().slice(0, 200)) || 'Generated runbook';
  return { title, body: body || `# ${title}\n` };
}
