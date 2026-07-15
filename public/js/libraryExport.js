const YAML_QUOTE_TRIGGER = /[:"\\\n#]|^-|^\s|\s$/;

function yamlString(value) {
  const str = String(value ?? '');
  if (str === '') return '""';
  if (!YAML_QUOTE_TRIGGER.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
}

function renderLinksBlock(links) {
  const groups = links || { 'derived-from': [], supersedes: [] };
  const relationOrder = ['derived-from', 'supersedes'];
  const lines = ['links:'];
  for (const relation of relationOrder) {
    const entries = Array.isArray(groups[relation]) ? groups[relation] : [];
    if (entries.length === 0) {
      lines.push(`  ${relation}: []`);
      continue;
    }
    lines.push(`  ${relation}:`);
    for (const entry of entries) {
      lines.push(`    - id: ${entry.id}`);
      lines.push(`      ref: ${yamlString(entry.ref || '')}`);
    }
  }
  return lines.join('\n');
}

function formatFrontMatter(doc, projectSlug, links) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`;
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown';
  const linksBlock = renderLinksBlock(links);

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${yamlString(doc.documentType || 'note')}`,
    `project: ${yamlString(slug)}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    `kind: ${doc.kind || 'source'}`,
    `content_hash: ${doc.contentHash || ''}`,
    `updated_by: ${doc.updatedBy || 'user'}`,
    linksBlock,
    '---',
    '',
  ].join('\n');
}

export function buildExportedMarkdown(doc, projectSlug, links) {
  const frontMatter = formatFrontMatter(doc, projectSlug, links);
  const body = String(doc?.body ?? '');
  if (body === '') return frontMatter;
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`;
  return `${frontMatter}\n${bodyWithNewline}`;
}

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
  const response = await fetchImpl(`/api/library/export?project=${encodeURIComponent(scope || 'all')}`);
  if (!response.ok) throw new Error(await archiveFetchError(response));
  return response.blob();
}

function pickerWasCancelled(error) {
  return error?.name === 'AbortError';
}

/**
 * Save an active-library Markdown archive using the strongest destination API
 * available to the host. Returns a truthful outcome; picker cancellation is
 * deliberately neutral rather than an error.
 */
export async function saveLibraryArchive({ scope = 'all', filename, mode, ...options } = {}) {
  const globalRef = options.globalRef || globalThis;
  const destinationMode = mode || libraryExportDestinationMode({
    desktopShell: options.desktopShell,
    globalRef,
  });
  const suggestedName = filename || libraryArchiveFilename(scope);

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
  anchor.href = `/api/library/export?project=${encodeURIComponent(scope || 'all')}`;
  anchor.download = suggestedName;
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  return { status: 'downloaded', filename: suggestedName };
}
