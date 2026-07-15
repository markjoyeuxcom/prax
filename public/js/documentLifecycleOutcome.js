// Observable canonical-state checks used after a lifecycle request loses its
// response. Only exact, server-readable state can turn an ambiguous transport
// failure into a committed outcome.
export function documentMatchesLifecycle(document, intent = {}) {
  switch (intent.type) {
    case 'verify':
      return Boolean(document) && Boolean(document.verified) === Boolean(intent.verified);
    case 'supersede':
      return Boolean(document) && document.status === 'superseded';
    case 'activate':
      return Boolean(document) && document.status === 'active';
    case 'archive':
      return Boolean(document?.archivedAt);
    case 'restore':
      return Boolean(document) && !document.archivedAt;
    case 'delete':
      return document === null;
    default:
      return false;
  }
}

export function lifecycleOutcomeMessage(action, outcome) {
  if (outcome === 'unknown') {
    return `Prax could not confirm the ${String(action).toLowerCase()} outcome. Reload before retrying.`;
  }
  if (outcome === 'refresh-failed') {
    return `${action} completed, but the library could not refresh. Reload to see canonical state.`;
  }
  if (outcome === 'reconciled') {
    return `${action} completed. Prax confirmed the result after the response was interrupted.`;
  }
  return null;
}
