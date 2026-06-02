const YAML_QUOTE_TRIGGER = /[:"\\\n#]|^-|^\s|\s$/

function yamlString(value) {
  const str = String(value ?? '')
  if (str === '') return '""'
  if (!YAML_QUOTE_TRIGGER.test(str)) return str
  return `"${str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function renderLinksBlock(links) {
  const groups = links || { 'derived-from': [], supersedes: [] }
  const relationOrder = ['derived-from', 'supersedes']
  const lines = ['links:']
  for (const relation of relationOrder) {
    const entries = Array.isArray(groups[relation]) ? groups[relation] : []
    if (entries.length === 0) {
      lines.push(`  ${relation}: []`)
      continue
    }
    lines.push(`  ${relation}:`)
    for (const entry of entries) {
      lines.push(`    - id: ${entry.id}`)
      lines.push(`      ref: ${yamlString(entry.ref || '')}`)
    }
  }
  return lines.join('\n')
}

export function formatFrontMatter(doc, projectSlug, links) {
  const tags = Array.isArray(doc.tags) ? doc.tags : []
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown'
  const linksBlock = renderLinksBlock(links)

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
  ].join('\n')
}

export function renderDocumentMarkdown(doc, projectSlug, links) {
  const frontMatter = formatFrontMatter(doc, projectSlug, links)
  const body = String(doc.body ?? '')
  if (body === '') return frontMatter
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`
  return `${frontMatter}\n${bodyWithNewline}`
}

function basename(value) {
  return String(value || '').split(/[\\/]/).pop() || ''
}

function stripLeadingDots(value) {
  return value.replace(/^\.+/, '')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function documentFilename(doc) {
  const raw = stripLeadingDots(basename(doc?.sourceFilename || '').trim())
  if (raw) {
    return /\.md$/i.test(raw) ? raw : `${raw}.md`
  }
  const slug = slugify(doc?.title || '')
  return slug ? `${slug}.md` : 'untitled.md'
}

export function computeLinkRef({ scope, currentDocProjectSlug, targetProjectSlug, targetSourceFilename, targetTitle }) {
  const filename = documentFilename({ sourceFilename: targetSourceFilename, title: targetTitle })
  if (scope === 'single-project' && currentDocProjectSlug === targetProjectSlug) {
    return filename
  }
  return `${targetProjectSlug || 'unknown'}/${filename}`
}

export function dedupeFilenames(entries) {
  const seen = new Map() // path -> Set of claimed filenames
  for (const entry of entries) {
    const claimed = seen.get(entry.path) || new Set()
    seen.set(entry.path, claimed)
    if (!claimed.has(entry.filename)) {
      claimed.add(entry.filename)
      continue
    }
    const ext = entry.filename.match(/\.md$/i)?.[0] || ''
    const stem = entry.filename.slice(0, entry.filename.length - ext.length)
    let n = 2
    let candidate
    do {
      candidate = `${stem}-${n}${ext}`
      n += 1
    } while (claimed.has(candidate))
    entry.filename = candidate
    claimed.add(candidate)
  }
}

export function libraryArchiveFilename(scope, date = new Date()) {
  const safe = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all'
  const day = date.toISOString().slice(0, 10)
  return `moomora-console-library-${safe}-${day}.zip`
}
