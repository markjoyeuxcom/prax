const KEY = 'prax.projectDrafts.v1';
const FIELDS = new Set(['onCall', 'handoffNotes', 'repoUrl', 'area']);
export function createProjectDrafts({ storage, save, read = null, onSaved = () => {}, onError = () => {} }) {
  let pending = {};
  const inFlight = new Map();
  try { pending = JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { /* keep current input if storage is unavailable */ }
  for (const [id, patch] of Object.entries(pending)) {
    if (!patch || typeof patch !== 'object') { delete pending[id]; continue; }
    for (const [field,value] of Object.entries(patch)) if (!FIELDS.has(field) || typeof value !== 'string') delete patch[field];
  }
  function persist() {
    try { if (!storage) throw Error('storage unavailable'); storage.setItem(KEY, JSON.stringify(pending)); return true; }
    catch { onError('Project draft is only kept in this window. Keep it open until saving succeeds.'); return false; }
  }
  function overlay(projects) { return projects.map(project => ({...project,...pending[project.id]})); }
  async function flush(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const run = (async () => {
      while (pending[id] && Object.keys(pending[id]).length) {
        const sent = {...pending[id]};
        let saved;
        try { saved = await save(id,sent); }
        catch {
          if (read) { try { const observed = await read(id); if (Object.entries(sent).every(([k,v]) => (observed?.[k] || '') === v.trim())) saved = observed; } catch {} }
          if (!saved) { onError('Project changes could not be confirmed. Your draft is kept; retry when ready.', id); return false; }
        }
        const acknowledged = {};
        for (const [field,value] of Object.entries(sent)) {
          if (pending[id]?.[field] === value) { delete pending[id][field]; acknowledged[field] = saved[field]; }
        }
        if (!Object.keys(pending[id] || {}).length) delete pending[id];
        persist();
        onSaved(id, acknowledged);
      }
      return true;
    })();
    inFlight.set(id,run);
    try { return await run; } finally { if (inFlight.get(id) === run) inFlight.delete(id); }
  }
  return {
    set(id,field,value) { if (!FIELDS.has(field)) throw Error('Unsupported project field'); (pending[id] ||= {})[field] = value; return persist(); },
    overlay, flush,
    flushAll: () => Promise.all(Object.keys(pending).map(flush)),
    hasPending: () => Object.values(pending).some(patch => Object.keys(patch).length > 0),
  };
}
