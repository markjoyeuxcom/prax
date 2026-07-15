export function runMatchesStartIntent(run, { id, documentId, title = '' } = {}) {
  return Boolean(run)
    && run.id === id
    && run.documentId === documentId
    && String(run.title || '') === String(title || '');
}

export function runMatchesStepIntent(run, stepId, checked) {
  const step = Array.isArray(run?.steps) ? run.steps.find((candidate) => candidate.id === stepId) : null;
  return Boolean(step) && Boolean(step.checkedAt) === Boolean(checked);
}

export function runMatchesStatusIntent(run, status) {
  return Boolean(run) && run.status === status;
}
