const KEY = 'prax.importRequests.v1';
function records(storage) { return JSON.parse(storage.getItem(KEY) || '{}'); }
export async function importRequestFor(storage, intent) {
  if (!storage) throw new Error('Import retry storage is unavailable.');
  const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const pending=records(storage);
  const id=typeof pending[digest] === 'string' ? pending[digest] : globalThis.crypto.randomUUID();
  pending[digest]=id;
  storage.setItem(KEY,JSON.stringify(pending));
  return {id,digest,intent};
}
export function completeImportRequest(storage,request) {
  try {
    const pending=records(storage);
    if (pending[request.digest]===request.id) delete pending[request.digest];
    storage.setItem(KEY,JSON.stringify(pending));
    return true;
  } catch { return false; }
}
