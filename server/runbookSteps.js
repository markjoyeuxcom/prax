// Extract executable steps from a runbook's Markdown: each checkbox list item
// (`- [ ]` / `- [x]`, tolerating `*`/`+` bullets and indentation) becomes an
// ordered step. `[x]` means the step is marked done in the *source*; a run
// snapshots only the text and starts every step unchecked, so a run's progress
// is independent of the document. Pure and side-effect free.
const STEP_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/;

export function parseRunbookSteps(markdown) {
  const steps = [];
  for (const line of String(markdown ?? '').split('\n')) {
    const match = line.match(STEP_RE);
    if (!match) continue;
    const text = match[2].trim();
    if (!text) continue;
    steps.push({ position: steps.length, text, initiallyChecked: match[1].toLowerCase() === 'x' });
  }
  return steps;
}
