import {
  buildCreatePayload,
  clearBarDraft,
  destinationHint,
  loadBarDraft,
  resolveCapture,
  saveBarDraft,
} from './captureBarCore.js';

// DOM glue for the system-wide capture bar (public/capture.html). All logic
// worth testing lives in captureBarCore.js; this file wires events, talks to
// the API, and (when running inside the desktop shell) hides its window via
// the shell's IPC. In a plain browser tab the same page still works — it is
// how the e2e suite drives it.

const input = document.getElementById('capture-input');
const hint = document.getElementById('capture-hint');
const storage = window.localStorage;

let projects = [];
let submitting = false;
// Exact-once retry identity: the payload (with its client-generated id) is
// kept while the text is unchanged, so retrying an ambiguous failure replays
// the SAME create instead of minting a duplicate.
let pending = null;

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
    if (response.ok) {
      projects = await response.json();
      renderDestination();
    }
  } catch { /* offline projects list: server still resolves on submit */ }
}

function hideWindow() {
  window.__TAURI__?.core?.invoke?.('hide_capture_window')?.catch?.(() => {});
}

async function submit() {
  if (submitting) return;
  const raw = input.value;
  const resolved = resolveCapture(raw, { projects });
  if (!resolved.ok) return;
  if (!pending || pending.raw !== raw) {
    pending = { raw, payload: buildCreatePayload(resolved, crypto.randomUUID()) };
  }
  submitting = true;
  setHint('Saving…');
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending.payload),
    });
    if (response.status === 201 || response.status === 200) {
      // 200 = the retry found the earlier create — same outcome, no duplicate.
      pending = null;
      input.value = '';
      clearBarDraft(storage);
      setHint(`Added to ${resolved.projectName} ✓`, 'ok');
      setTimeout(() => { setHint(''); hideWindow(); }, 600);
    } else {
      // A deterministic rejection (400/409) will not succeed by replaying the
      // identical payload — drop the retry identity so the next attempt is a
      // fresh create the user has presumably edited.
      pending = null;
      const body = await response.json().catch(() => ({}));
      setHint(body.message || `Prax rejected the capture (${response.status}).`, 'error');
    }
  } catch {
    // Ambiguous transport failure: keep the text AND the retry identity.
    setHint('Prax is unreachable — your text is kept; Enter retries.', 'error');
  } finally {
    submitting = false;
  }
}

input.addEventListener('input', () => {
  if (pending && pending.raw !== input.value) pending = null;
  saveBarDraft(storage, input.value);
  renderDestination();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); submit(); }
  if (event.key === 'Escape') { event.preventDefault(); hideWindow(); }
});

// Each summon re-focuses the field (the shell only shows/hides the window).
window.addEventListener('focus', () => { input.focus(); input.select(); });

input.value = loadBarDraft(storage);
renderDestination();
input.focus();
refreshProjects();
