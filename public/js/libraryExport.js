const YAML_QUOTE_TRIGGER = /[:"\\\n#]|^-|^\s|\s$/;

function yamlString(value) {
  const str = String(value ?? '');
  if (str === '') return '""';
  if (!YAML_QUOTE_TRIGGER.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
}

function formatFrontMatter(doc, projectSlug) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`;
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown';

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${yamlString(doc.documentType || 'note')}`,
    `project: ${yamlString(slug)}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    '---',
    '',
  ].join('\n');
}

export function buildExportedMarkdown(doc, projectSlug) {
  const frontMatter = formatFrontMatter(doc, projectSlug);
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
