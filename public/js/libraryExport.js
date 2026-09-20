export { renderDocumentMarkdown as buildExportedMarkdown } from './documentMarkdownExport.js';

function basename(value) {
  return String(value || '').split(/[\\/]/).pop() || '';
}

function stripLeadingDots(value) {
  return value.replace(/^\.+/, '');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function documentFilename(doc) {
  const raw = stripLeadingDots(basename(doc?.sourceFilename || '').trim());
  if (raw) return /\.md$/i.test(raw) ? raw : `${raw}.md`;
  const slug = slugify(doc?.title || '');
  return slug ? `${slug}.md` : 'untitled.md';
}

export function triggerDownload(filename, blob, options = {}) {
  const documentRef = options.documentRef || document;
  const URLRef = options.URLRef || URL;
  const url = URLRef.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  URLRef.revokeObjectURL(url);
}

export function triggerLibraryDocumentDownload(documentId, options = {}) {
  const documentRef = options.documentRef || document;
  const url = `/api/library/documents/${documentId}/export`;
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  // Empty download attribute lets the browser honor the server's
  // Content-Disposition filename header.
  anchor.download = '';
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
}

export function libraryArchiveFilename(scope = 'all', now = new Date()) {
  const safeScope = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all';
  const day = now.toISOString().slice(0, 10);
  return `prax-library-${safeScope}-${day}.zip`;
}

export function workspaceArchiveFilename(now = new Date()) {
  return `prax-workspace-${now.toISOString().slice(0, 10)}.zip`;
}

export function libraryArchiveUrl(scope = 'all', { format = 'markdown', includeArchived = false } = {}) {
  if (format === 'workspace') return '/api/workspace/backup';
  return `/api/library/export?project=${encodeURIComponent(scope || 'all')}${includeArchived ? '&includeArchived=true' : ''}`;
}

export function libraryExportDestinationMode(options = {}) {
  const globalRef = options.globalRef || globalThis;
  if (options.desktopShell && typeof globalRef.__TAURI__?.core?.invoke === 'function') return 'desktop';
  if (typeof globalRef.showSaveFilePicker === 'function') return 'browser-picker';
  return 'download';
}

export function libraryExportFailureMessage(error) {
  const detail = typeof error === 'string' ? error.trim() : String(error?.message || '').trim();
  if (!detail) return 'Prax could not create or save the Library archive.';
  return `Prax could not create or save the Library archive: ${detail}`;
}

async function archiveFetchError(response) {
  try {
    const payload = await response.clone().json();
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  } catch { /* response was not JSON */ }
  return `Archive request failed (${response.status || 'unknown status'}).`;
}

export async function fetchLibraryArchive(scope, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(libraryArchiveUrl(scope, options));
  if (!response.ok) throw new Error(await archiveFetchError(response));
  return response.blob();
}

function pickerWasCancelled(error) {
  return error?.name === 'AbortError';
}

/**
 * Save a Markdown archive or a complete workspace backup using the strongest destination API
 * available to the host. Returns a truthful outcome; picker cancellation is
 * deliberately neutral rather than an error.
 */
export async function saveLibraryArchive({ scope = 'all', filename, mode, ...options } = {}) {
  const globalRef = options.globalRef || globalThis;
  const destinationMode = mode || libraryExportDestinationMode({
    desktopShell: options.desktopShell,
    globalRef,
  });
  const suggestedName = filename || (options.format === 'workspace' ? workspaceArchiveFilename() : libraryArchiveFilename(scope));

  if (destinationMode === 'browser-picker') {
    let handle;
    try {
      // Must remain first: browsers require the picker to consume the direct
      // user activation before any awaited network work.
      handle = await globalRef.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (error) {
      if (pickerWasCancelled(error)) return { status: 'cancelled' };
      throw error;
    }

    const blob = await fetchLibraryArchive(scope, options);
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      try { await writable.abort?.(); } catch { /* retain the original write error */ }
      throw error;
    }
    return { status: 'saved', filename: suggestedName };
  }

  if (destinationMode === 'desktop') {
    const blob = await fetchLibraryArchive(scope, options);
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const path = await globalRef.__TAURI__.core.invoke('save_library_export', {
      fileName: suggestedName,
      bytes,
    });
    if (!path) return { status: 'cancelled' };
    return { status: 'saved', filename: suggestedName, path };
  }

  const documentRef = options.documentRef || globalRef.document;
  const anchor = documentRef.createElement('a');
  anchor.href = libraryArchiveUrl(scope, options);
  anchor.download = suggestedName;
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  return { status: 'downloaded', filename: suggestedName };
}
