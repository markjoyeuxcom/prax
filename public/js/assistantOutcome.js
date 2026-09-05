// Turn an assistant response plus the cache-refresh result into truthful UI
// feedback. A committed write is never described as failed or retryable: doing
// so could make the person repeat an action that already changed their data.
export function assistantOutcomeNotice(result, { refreshed = true } = {}) {
  if (result?.outcomeUnknown) {
    const recovery = refreshed
      ? 'Check the refreshed workspace before starting a new action.'
      : 'The workspace could not refresh; reload before checking it or starting a new action.';
    return { kind: 'partial', text: `An interrupted approved action may already have completed. ${recovery} This approval is guarded against being run twice.` };
  }
  const detail = result?.error ? ` (${String(result.error)})` : '';

  if (result?.status === 'error' && result?.didWrite) {
    if (refreshed) {
      return {
        kind: 'partial',
        text: `The approved change completed, but the assistant could not produce its follow-up${detail}. Your workspace is refreshed. Do not repeat the action.`,
      };
    }
    return {
      kind: 'partial',
      text: `The approved change completed, but the assistant follow-up and workspace refresh failed${detail}. Reload to see the committed change. Do not repeat the action.`,
    };
  }

  if (result?.didWrite && !refreshed) {
    return {
      kind: 'partial',
      text: 'The approved change completed, but the workspace could not refresh. Reload to see the committed change. Do not repeat the action.',
    };
  }

  if (result?.status === 'error') {
    return {
      kind: 'error',
      text: result.error
        ? `The assistant hit an error: ${result.error}`
        : 'The assistant hit an error. Please try again.',
    };
  }

  return null;
}
