export { formatFrontMatter, renderDocumentMarkdown } from '../public/js/documentMarkdownExport.js';

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

export function buildLinksFromGroups(groups, { scope, currentDocProjectSlug }) {
  const mapEntries = (entries) => (entries || []).map((e) => ({
    id: e.targetId,
    ...(e.targetHash !== undefined ? { targetHash: e.targetHash } : {}),
    ref: computeLinkRef({
      scope,
      currentDocProjectSlug,
      targetProjectSlug: e.targetProjectSlug,
      targetSourceFilename: e.targetSourceFilename,
      targetTitle: e.targetTitle,
    }),
  }));
  return {
    'derived-from': mapEntries(groups['derived-from']),
    supersedes: mapEntries(groups.supersedes),
  };
}

export function libraryArchiveFilename(scope, date = new Date()) {
  const safe = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all'
  const day = date.toISOString().slice(0, 10)
  return `prax-library-${safe}-${day}.zip`
}
