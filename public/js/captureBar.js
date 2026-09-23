import {
  buildCreatePayload, destinationHint, loadBarDraft, loadBarPending,
  resolveCapture, saveBarDraft, saveBarPending, finishBarCapture,
} from './captureBarCore.js';
import { announceChange } from './externalRefresh.js';
import { isImeComposing } from './keyboardShortcuts.js';

const input = document.getElementById('capture-input');
const hint = document.getElementById('capture-hint');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
let projects = [];
let submitting = false;
let inputRevision = 0;
let pending = loadBarPending(storage);
let hideTimer;
function setHint(text, kind) {
  hint.textContent = text;
  if (kind) hint.dataset.kind = kind;
  else delete hint.dataset.kind;
}
function renderDestination() {
  const resolved = resolveCapture(input.value, { projects });
  setHint(resolved.ok ? destinationHint(resolved) : '');
}
async function refreshProjects() {
  try {
    const response = await fetch('/api/projects');
    if (response.ok) { projects = await response.json(); renderDestination(); }
  } catch { /* the capture text and submitted payload remain recoverable */ }
}
function hideWindow() { window.__TAURI__?.core?.invoke?.('hide_capture_window')?.catch?.(() => {}); }
async function submit() {
  if (submitting) return;
  const raw = input.value;
  const resolved = resolveCapture(raw, { projects });
  if (!pending && !resolved.ok) return;
  if (!pending) {
    pending = { raw, payload: buildCreatePayload(resolved, crypto.randomUUID()) };
    if (!saveBarPending(storage, pending)) {
      pending = null;
      setHint('Capture recovery could not be saved. Keep this window open and try again.', 'error');
      return;
    }
  }
  // An earlier uncertain intent is reconciled first even if newer text exists.
  // Enter can never replace its identity and unknowingly create it twice.
  const submitted = pending, revision = inputRevision;
  submitting = true;
  clearTimeout(hideTimer);
  setHint('Saving…');
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitted.payload),
    });
    if (response.status === 201 || response.status === 200) {
      const clearDraft = inputRevision === revision && input.value === submitted.raw;
      if (!finishBarCapture(storage, submitted.payload.id, clearDraft)) {
        setHint('Task saved. Recovery could not be cleared; Enter safely checks it again.', 'error');
        return;
      }
      pending = null;
      // Let the main window (a separate webview on the desktop) refetch now
      // rather than on its next focus; best-effort, focus remains the guarantee.
      announceChange({ type: 'task-created', id: submitted.payload.id });
      if (clearDraft) {
        input.value = '';
        setHint(`Added to ${resolved.projectName} ✓`, 'ok');
        hideTimer = setTimeout(() => { if (!input.value && inputRevision === revision) { setHint(''); hideWindow(); } }, 600);
      } else setHint('Previous capture saved. Your current text is kept; Enter adds it.', 'ok');
    } else if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      let canonical = null;
      try {
        const getRes = await fetch(`/api/tasks/${encodeURIComponent(submitted.payload.id)}`);
        if (getRes.ok) canonical = await getRes.json();
      } catch { /* network or fetch failure */ }

      if (canonical) {
        const clearDraft = inputRevision === revision && input.value === submitted.raw;
        if (!finishBarCapture(storage, submitted.payload.id, clearDraft)) {
          setHint('Task confirmed. Recovery could not be cleared; Enter safely checks it again.', 'error');
          return;
        }
        pending = null;
        announceChange({ type: 'task-created', id: submitted.payload.id });
        const projectObj = projects.find((p) => p.id === canonical.projectId || p.slug === canonical.projectId);
        const pName = projectObj ? projectObj.name : (resolved.projectName || 'Inbox');

        if (canonical.archivedAt) {
          if (clearDraft) {
            input.value = '';
            setHint('Task was already created and is now archived.', 'ok');
            hideTimer = setTimeout(() => { if (!input.value && inputRevision === revision) { setHint(''); hideWindow(); } }, 1200);
          } else {
            setHint('Previous capture was archived. Your current text is kept; Enter adds it.', 'ok');
          }
        } else if (canonical.title !== submitted.payload.title) {
          if (clearDraft) {
            input.value = '';
            setHint(`Added to ${pName} ✓ (changed: "${canonical.title}")`, 'ok');
            hideTimer = setTimeout(() => { if (!input.value && inputRevision === revision) { setHint(''); hideWindow(); } }, 1200);
          } else {
            setHint('Previous capture saved (changed). Your current text is kept; Enter adds it.', 'ok');
          }
        } else {
          if (clearDraft) {
            input.value = '';
            setHint(`Added to ${pName} ✓`, 'ok');
            hideTimer = setTimeout(() => { if (!input.value && inputRevision === revision) { setHint(''); hideWindow(); } }, 600);
          } else {
            setHint('Previous capture saved. Your current text is kept; Enter adds it.', 'ok');
          }
        }
      } else {
        // Cannot read canonical task: keep identity and unknown outcome (never mint a new identity implicitly)
        setHint(body.message || 'Prax could not confirm the capture (409). Enter checks it again.', 'error');
      }
    } else {
      const body = await response.json().catch(() => ({}));
      // Only deterministic rejections release the submitted intent: validation,
      // or 410 (this capture was created and later permanently deleted, so its
      // receipt refuses to recreate it). Server failures can occur after
      // commit and must retain its identity.
      if ([400, 410, 422].includes(response.status) && saveBarPending(storage, null)) pending = null;
      setHint(body.message || `Prax could not confirm the capture (${response.status}). Enter checks it again.`, 'error');
    }
  } catch { setHint('Prax is unreachable — your text and submitted capture are kept; Enter retries.', 'error'); }
  finally { submitting = false; }
}
input.addEventListener('input', () => {
  inputRevision++;
  clearTimeout(hideTimer);
  if (!saveBarDraft(storage, input.value)) setHint('Draft is only kept in this window. Keep it open until recovery storage is available.', 'error');
  else renderDestination();
});
input.addEventListener('keydown', event => {
  if (isImeComposing(event)) return; // Enter/Escape commit or cancel the composition
  if (event.key === 'Enter') { event.preventDefault(); void submit(); }
  if (event.key === 'Escape') { event.preventDefault(); hideWindow(); }
});
window.addEventListener('focus', () => { input.focus(); input.select(); });
input.value = loadBarDraft(storage);
renderDestination();
input.focus();
void refreshProjects();
