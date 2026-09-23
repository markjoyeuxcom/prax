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

// The key two archive names collide under once extracted. macOS (APFS/HFS+)
// and Windows file systems are case-insensitive and treat NFC/NFD spellings as
// one name, so `Setup.md` and `setup.md` (or composed and decomposed `café.md`)
// would overwrite each other. Names keep their spelling; only the key folds.
function collisionKey(name) {
  return String(name).normalize('NFC').toLowerCase().normalize('NFC')
}

export function dedupeFilenames(entries) {
  const seen = new Map() // folded path -> Set of folded claimed filenames
  for (const entry of entries) {
    const pathKey = collisionKey(entry.path)
    const claimed = seen.get(pathKey) || new Set()
    seen.set(pathKey, claimed)
    if (!claimed.has(collisionKey(entry.filename))) {
      claimed.add(collisionKey(entry.filename))
      continue
    }
    const ext = entry.filename.match(/\.md$/i)?.[0] || ''
    const stem = entry.filename.slice(0, entry.filename.length - ext.length)
    let n = 2
    let candidate
    do {
      candidate = `${stem}-${n}${ext}`
      n += 1
    } while (claimed.has(collisionKey(candidate)))
    entry.filename = candidate
    claimed.add(collisionKey(candidate))
  }
}

// Where each exported document lands. `flat` is the ZIP layout (a folder per
// project only for an all-projects export). `mirror` is the layout of
// `prax mirror`: active documents at the folder root, superseded and
// deprecated ones under `retired/`, and the mirror's own README.md reserved so
// a document can never overwrite it (it takes the usual collision suffix).
// Entries keep the documents' order, which decides who keeps a bare name.
export const EXPORT_LAYOUTS = ['flat', 'mirror']
export const MIRROR_RETIRED_FOLDER = 'retired/'
export const MIRROR_RESERVED_NAMES = ['README.md']

export function isRetiredStatus(status) {
  return status === 'superseded' || status === 'deprecated'
}

export function buildExportEntries(documents, { isAll = false, layout = 'flat' } = {}) {
  const mirror = layout === 'mirror'
  const projectPath = (doc) => (isAll ? `${doc.projectSlug || 'unknown'}/` : '')
  const entries = documents.map((doc) => ({
    doc,
    path: `${projectPath(doc)}${mirror && isRetiredStatus(doc.status) ? MIRROR_RETIRED_FOLDER : ''}`,
    filename: documentFilename(doc),
  }))
  if (!mirror) {
    dedupeFilenames(entries)
    return entries
  }
  const roots = isAll ? [...new Set(documents.map(projectPath))] : ['']
  const reserved = roots.flatMap((path) => MIRROR_RESERVED_NAMES.map((filename) => ({ reserved: true, path, filename })))
  const all = [...reserved, ...entries]
  dedupeFilenames(all)
  return all.filter((entry) => !entry.reserved)
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

// A Content-Disposition value for a download. Node rejects header characters
// above 0xFF (a CJK or emoji filename was a 500), and a raw quote or backslash
// breaks the quoted-string. So `filename` carries an ASCII fallback with every
// other character replaced, and a name that needed that also gets the exact
// UTF-8 name as RFC 5987 `filename*`, which every current browser prefers.
export function attachmentDisposition(filename) {
  const name = String(filename || '').toWellFormed() || 'download'
  const fallback = name.replace(/[^\x20-\x7e]+|["\\%]/g, '_')
  if (fallback === name) return `attachment; filename="${name}"`
  const encoded = encodeURIComponent(name)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
