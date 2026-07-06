// Board-extras cache helpers (docs/checklist/activity signals on cards and
// list rows). Pure logic extracted from the previous main.js so the fetch
// discipline is testable: only fetch ids that are neither cached nor in
// flight, in batches of 50 (the server caps a request at 200).

export const BOARD_EXTRA_FETCH_BATCH_SIZE = 50;

export function pendingExtraIds(taskIds, extras = {}, loading = {}) {
  const seen = new Set();
  const out = [];
  for (const id of taskIds || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (extras[id] !== undefined) continue;
    if (loading[id]) continue;
    out.push(id);
  }
  return out;
}

export function batchIds(ids, size = BOARD_EXTRA_FETCH_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < (ids || []).length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}

// Invalidate one task's cached extras after a mutation (notes save, checklist
// add/toggle/delete, doc link/unlink, board drop). Returns a state patch.
export function clearTaskBoardExtra(state, taskId) {
  if (!taskId || state.taskBoardExtras[taskId] === undefined) return {};
  const next = { ...state.taskBoardExtras };
  delete next[taskId];
  return { taskBoardExtras: next };
}
