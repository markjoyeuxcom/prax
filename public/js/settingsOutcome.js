// Readback comparison for provider-setting mutations. API keys never come
// back; hasApiKey is the strongest canonical evidence available for a set or
// clear operation.
export function settingsPatchMatchesStatus(patch, status, previousStatus = null) {
  if (!patch || !status) return false;
  if (patch.backend !== undefined && status.backend !== patch.backend) return false;
  if (patch.model !== undefined && status.model !== patch.model) return false;
  if (patch.baseUrl !== undefined && status.baseUrl !== patch.baseUrl) return false;
  // The server stores the trimmed path and reports '' for auto-detect.
  if (patch.binaryPath !== undefined && String(status.binaryPath ?? '') !== String(patch.binaryPath).trim()) return false;
  if (patch.enabled !== undefined && Boolean(status.enabled) !== Boolean(patch.enabled)) return false;
  if (patch.apiKey !== undefined) {
    const expected = patch.apiKey !== '';
    if (Boolean(status.hasApiKey) !== expected) return false;
    // A redacted readback cannot distinguish a newly submitted key from a
    // different key that was already stored. Only a false→true transition is
    // positive evidence for a non-empty key write; otherwise stay unknown and
    // preserve the draft instead of claiming success.
    if (expected && previousStatus?.hasApiKey !== false) return false;
  }
  return true;
}

// The answer-model form as typed, kept while a save is in flight and after a
// save whose outcome is not confirmed, so the inputs re-render with it. Every
// field the form can show is captured — a field left out here re-renders
// from the stored status and silently loses what was typed.
export function chatSettingsDraftFrom(backend, { model, baseUrl, apiKey, binaryPath } = {}) {
  return {
    backend: backend || 'none',
    model: model ?? '',
    baseUrl: baseUrl ?? '',
    apiKey: apiKey ?? '',
    // Only the CLI providers show a binary path; absent, the stored one renders.
    ...(binaryPath != null ? { binaryPath } : {}),
  };
}
