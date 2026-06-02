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
