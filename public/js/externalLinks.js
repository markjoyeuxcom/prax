// Links that leave the app: document preview links, external references and
// any other http(s) anchor. Prax is one page, so following such a link in place
// would replace the workspace (browser build) or be refused by the desktop
// window's navigation policy, which admits only the sidecar origin (desktop).
// Instead the browser opens a new tab and the desktop hands the URL to the
// system browser through the shell plugin's `open` command (http/https only;
// see src-tauri/capabilities/remote.json).

// The absolute http(s) URL an anchor points to, or null for in-page (#…),
// data-action, and non-web links. Root-relative links count: in the desktop
// window they would navigate the app itself away.
export function externalLinkUrl(anchor, pageHref) {
  if (!anchor || anchor.hasAttribute?.('data-action') || anchor.hasAttribute?.('download')) return null;
  const raw = String(anchor.getAttribute?.('href') || '').trim();
  if (!raw || raw.startsWith('#')) return null;
  let url;
  try { url = new URL(raw, pageHref); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

// Resolves true when the link was handed off, false when no route exists.
// window.open with noopener returns null by design, so the browser branch
// cannot observe a popup blocker; it reports the attempt.
export async function openExternalUrl(url, { desktopShell = false, globalRef = globalThis } = {}) {
  if (desktopShell) {
    const invoke = globalRef.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') return false;
    await invoke('plugin:shell|open', { path: url });
    return true;
  }
  if (typeof globalRef.open !== 'function') return false;
  globalRef.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
