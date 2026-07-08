// One normalization convention for task labels, shared by the drawer, quick
// capture, and the filter grammar — it mirrors the server normalizer
// (server/tasksRoutes.js) so a label typed anywhere matches @label everywhere:
// trim, strip a leading '@', lowercase.
export function normalizeLabel(raw) {
  return String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

export function normalizeLabels(values) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const label = normalizeLabel(raw);
    if (label && !seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}
