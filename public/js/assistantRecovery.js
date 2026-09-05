const KEY = 'prax.assistantApproval.v1';
export function loadAssistantRecovery(storage) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || 'null');
    if (!value || !Array.isArray(value.messages) || !Array.isArray(value.pending) || !value.pending.length) return null;
    return {messages:value.messages,pending:value.pending,attempted:Boolean(value.attempted)};
  } catch { return null; }
}
export function saveAssistantRecovery(storage, value) {
  try {
    if (!storage) return false;
    if (value?.pending?.length) storage.setItem(KEY, JSON.stringify(value));
    else storage.removeItem(KEY);
    return true;
  } catch { return false; }
}
