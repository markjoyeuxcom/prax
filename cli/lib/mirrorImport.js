// `prax mirror import`: read a Library mirror folder back into a library.
// Git is never a second writer: a document that already exists keeps the
// library's copy, and a retired file is not revived. Creation goes through the
// Markdown-import route (POST /api/library/documents with the document's own
// UUID), whose record-creation receipt makes each create exact-once.
//
// Verification in a file is a CLAIM made by whoever could commit to the
// repository. It is honoured only for a trusted verifier (a list the operator
// passes, never read from the mirror), over a body that still hashes to the
// claimed content hash, and after a person confirms in an attended terminal.
// See docs/design/library-git-mirror.md#trust-rule.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import {
  isMirrorDocumentPath, MIRROR_FORMAT, MIRROR_INDEX, parseMirrorMarkdown, recoverBody, sha256,
} from './mirrorFormat.js';
import { MirrorError } from './mirror.js';

// The trusted verifier names: --trust-verifier first, else PRAX_TRUSTED_VERIFIERS.
export function trustedVerifiers({ flag, env = process.env } = {}) {
  const source = flag ?? env.PRAX_TRUSTED_VERIFIERS ?? '';
  return [...new Set(String(source).split(',').map((name) => name.trim()).filter(Boolean))];
}

export function readMirrorFolder(dir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MIRROR_INDEX), 'utf8'));
  } catch {
    throw new MirrorError(`${dir} holds no readable ${MIRROR_INDEX}; import reads a folder written by \`prax mirror\`.`);
  }
  if (manifest?.format !== MIRROR_FORMAT || !Array.isArray(manifest.documents)) {
    throw new MirrorError(`${join(dir, MIRROR_INDEX)} is not a Prax mirror manifest.`);
  }
  const files = [];
  const problems = [];
  for (const entry of manifest.documents) {
    if (!isMirrorDocumentPath(entry?.path)) { problems.push({ path: String(entry?.path), reason: 'not a mirror document path' }); continue; }
    let text;
    try { text = readFileSync(join(dir, entry.path), 'utf8'); } catch { problems.push({ path: entry.path, reason: 'file missing' }); continue; }
    const parsed = parseMirrorMarkdown(text);
    if (!parsed) { problems.push({ path: entry.path, reason: 'not a Markdown v3 document' }); continue; }
    files.push({ path: entry.path, ...parsed });
  }
  return { manifest, files, problems };
}

// Why a file's verification claim may or may not be honoured, before the
// library copy and the person are consulted. null = the claim stands so far.
export function claimProblem(meta, bodyMatches, trusted) {
  if (meta.verified !== true) return 'not claimed';
  const name = typeof meta.verified_by === 'string' ? meta.verified_by.trim() : '';
  if (!name) return 'no verifier named';
  if (!trusted.includes(name)) return `verifier "${name}" is not trusted`;
  if (!bodyMatches) return 'body changed after verification (content hash mismatch)';
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Interactive confirmation for the trusted claims. `null` input/output (or a
// non-TTY) cannot confirm, and the claims are reported instead of applied.
export async function confirmClaims(claims, { input, output }) {
  if (!claims.length) return false;
  if (!input?.isTTY || !output?.isTTY) return false;
  output.write(`\n${claims.length} document${claims.length === 1 ? '' : 's'} carry a trusted verification claim:\n`);
  for (const claim of claims) output.write(`  - ${claim.title} (${claim.id}) — verified by ${claim.verifier}\n`);
  const phrase = `VERIFY ${claims.length}`;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Type "${phrase}" to record these verifications (anything else leaves them unverified): `);
    return answer.trim() === phrase;
  } finally {
    rl.close();
  }
}

// Import every active document of the folder into `project`. `confirm` is
// called with the trusted claims and resolves true to apply them.
export async function importMirror(client, { dir, project, trusted = [], confirm = async () => false }) {
  const { files, problems } = readMirrorFolder(dir);
  const report = {
    created: [], present: [], conflicts: [], gone: [], retired: [], failed: [], invalid: problems,
    verified: [], unverifiedClaims: [],
  };
  const candidates = [];
  for (const file of files) {
    const { meta } = file;
    const label = { path: file.path, id: meta.id ?? null, title: meta.title ?? null };
    if (!UUID_RE.test(String(meta.id || ''))) { report.invalid.push({ ...label, reason: 'no document id' }); continue; }
    if ((meta.status || 'active') !== 'active') { report.retired.push({ ...label, status: meta.status }); continue; }
    if (typeof meta.title !== 'string' || !meta.title.trim()) { report.invalid.push({ ...label, reason: 'no title' }); continue; }
    const { body, matches } = recoverBody(file.body, meta.content_hash);
    let existing = null;
    try {
      existing = await client.getDocument(meta.id);
    } catch (error) {
      if (error.status !== 404) { report.failed.push({ ...label, reason: error.message }); continue; }
    }
    let document = existing;
    if (existing) {
      if (existing.contentHash === sha256(body) && existing.title === meta.title) report.present.push(label);
      else { report.conflicts.push({ ...label, reason: 'exists with different content; the library copy is kept' }); continue; }
    } else {
      try {
        document = await client.createMemory({
          id: meta.id,
          project,
          title: meta.title,
          body,
          documentType: typeof meta.type === 'string' ? meta.type : 'note',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          kind: meta.kind === 'synthesized' ? 'synthesized' : 'source',
          sourceFilename: typeof meta.source_filename === 'string' ? meta.source_filename : null,
          verified: false,
        });
      } catch (error) {
        if (error.status === 409) report.conflicts.push({ ...label, reason: 'id already used for different content; the library copy is kept' });
        else if (error.status === 410) report.gone.push({ ...label, reason: 'created before and permanently deleted here; not recreated' });
        else report.failed.push({ ...label, reason: error.message });
        continue;
      }
      report.created.push(label);
      await reattachReferences(client, document.id, meta, report, label);
    }
    const problem = claimProblem(meta, matches, trusted);
    if (problem === 'not claimed') continue;
    if (problem) { report.unverifiedClaims.push({ ...label, reason: problem }); continue; }
    if (document.verified) continue;
    if (document.contentHash !== meta.content_hash) {
      report.unverifiedClaims.push({ ...label, reason: 'library copy differs from the verified body' });
      continue;
    }
    candidates.push({ ...label, verifier: meta.verified_by.trim(), document });
  }
  if (candidates.length) {
    if (await confirm(candidates)) {
      for (const claim of candidates) {
        try {
          await client.verify(claim.document.id, {
            verified: true, as: claim.verifier, revision: claim.document.revision, contentHash: claim.document.contentHash,
          });
          report.verified.push({ path: claim.path, id: claim.id, title: claim.title, verifier: claim.verifier });
        } catch (error) {
          report.unverifiedClaims.push({ path: claim.path, id: claim.id, title: claim.title, reason: `verify failed: ${error.message}` });
        }
      }
    } else {
      for (const claim of candidates) {
        report.unverifiedClaims.push({ path: claim.path, id: claim.id, title: claim.title, reason: 'trusted claim not confirmed (needs an attended terminal)' });
      }
    }
  }
  return report;
}

// External references are an idempotent upsert; code citations are attached
// only to a document this run created, so a re-run cannot duplicate them.
async function reattachReferences(client, id, meta, report, label) {
  for (const ref of Array.isArray(meta.external_refs) ? meta.external_refs : []) {
    if (!ref?.url) continue;
    try { await client.addExternalRef(id, { url: ref.url, label: ref.label ?? undefined }); }
    catch (error) { report.failed.push({ ...label, reason: `external reference ${ref.url}: ${error.message}` }); }
  }
  for (const ref of Array.isArray(meta.code_refs) ? meta.code_refs : []) {
    if (!ref?.path) continue;
    try {
      await client.addCodeRef(id, {
        path: ref.path, startLine: ref.startLine ?? null, endLine: ref.endLine ?? null,
        commitSha: ref.commitSha ?? null, contentHash: ref.contentHash,
      });
    } catch (error) { report.failed.push({ ...label, reason: `code citation ${ref.path}: ${error.message}` }); }
  }
}

export function formatImportReport(report, { dir, project }) {
  const lines = [`Imported ${dir} into ${project}: ${report.created.length} created, ${report.present.length} already present, ${report.verified.length} verified.`];
  const section = (title, list, show = (item) => `${item.path}${item.reason ? ` — ${item.reason}` : ''}`) => {
    if (!list.length) return;
    lines.push(`${title} (${list.length}):`);
    for (const item of list) lines.push(`  ${show(item)}`);
  };
  section('Created', report.created, (item) => `${item.path} (${item.id})`);
  section('Verified from trusted claims', report.verified, (item) => `${item.path} — verified by ${item.verifier}`);
  section('Left unverified', report.unverifiedClaims);
  section('Skipped, library copy kept', report.conflicts);
  section('Skipped, permanently deleted here', report.gone);
  section('Skipped, retired (links do not round-trip)', report.retired, (item) => `${item.path} (${item.status})`);
  section('Invalid', report.invalid);
  section('Failed', report.failed);
  return lines.join('\n');
}
