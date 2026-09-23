// The on-disk shape of a Library mirror (`prax mirror`): its manifest, the
// paths it may own, and a reader for the Markdown v3 files the server renders
// (public/js/documentMarkdownExport.js). Deliberately dependency-free: the CLI
// ships beside the app and must not import the server's renderer.
import { createHash } from 'node:crypto';

export const MIRROR_FORMAT = 'prax.library-mirror';
export const MIRROR_VERSION = 1;
export const MIRROR_INDEX = 'index.json';
export const MIRROR_README = 'README.md';
export const MIRROR_RETIRED = 'retired';
export const DEFAULT_MIRROR_DIR = '.prax/library';

// A document path the mirror may write or delete: a `.md` file at the folder
// root or directly under retired/. Anything else — a manifest edited to name
// `../../somewhere` — is refused, so the mirror can never reach outside it.
export function isMirrorDocumentPath(path) {
  return typeof path === 'string'
    && /^(?:retired\/)?[^/\\\0]+\.md$/i.test(path)
    && !path.split('/').some((part) => part === '.' || part === '..')
    && path.toLowerCase() !== MIRROR_README.toLowerCase();
}

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') || value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

// Split a v3 file into its front matter (a flat object; `tags` as an array,
// the `links:` block skipped — document links do not round-trip through git)
// and its body. Returns null when the text is not a v3 document.
export function parseMirrorMarkdown(text) {
  const source = String(text ?? '');
  if (!source.startsWith('---\n')) return null;
  const close = source.indexOf('\n---\n', 3);
  if (close === -1) return null;
  const lines = source.slice(4, close).split('\n');
  const rest = source.slice(close + 5);
  const meta = {};
  let listKey = null;
  for (const line of lines) {
    if (line.startsWith(' ')) {
      const item = /^ {2}- (.*)$/.exec(line);
      if (listKey && item) meta[listKey].push(String(parseScalar(item[1]) ?? ''));
      continue;
    }
    listKey = null;
    const match = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (value === undefined || value === '') {
      if (key === 'tags') { meta.tags = []; listKey = 'tags'; }
      continue;
    }
    meta[key] = parseScalar(value);
  }
  if (Number(meta.prax_export_version) !== 3) return null;
  return { meta, body: rest.startsWith('\n') ? rest.slice(1) : rest };
}

// The renderer gives every non-empty body a final newline, so a stored body
// without one comes back with one. The content hash says which it was.
// Returns { body, matches } — `matches` false when neither spelling hashes to
// the claim (the file was edited after it was mirrored).
export function recoverBody(body, contentHash) {
  if (sha256(body) === contentHash) return { body, matches: true };
  if (body.endsWith('\n') && sha256(body.slice(0, -1)) === contentHash) {
    return { body: body.slice(0, -1), matches: true };
  }
  return { body, matches: false };
}
