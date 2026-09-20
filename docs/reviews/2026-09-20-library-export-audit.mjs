// Read-only product audit using a disposable production SQLite instance.
// Run: node docs/reviews/2026-09-20-library-export-audit.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { DOCUMENT_TYPE_VALUES } from '../../public/js/documentTypes.js';

function entries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP has central directory');
  const result = new Map();
  let offset = buffer.readUInt32LE(end + 16);
  const limit = offset + buffer.readUInt32LE(end + 12);
  while (offset < limit) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20);
    const names = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + names).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + size);
    result.set(name, (method === 0 ? bytes : inflateRawSync(bytes)).toString('utf8'));
    offset += 46 + names + extra + comment;
  }
  return result;
}

const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
async function call(method, url, payload, status = 200, headers) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers });
  assert.equal(response.statusCode, status, response.body); return response.json();
}
const create = (title, type = 'note', project = 'work', extra = {}) => call('POST', '/api/library/documents', {
  title, body: `Saved body for ${title}`, documentType: type, project, tags: ['export-audit'], ...extra,
}, 201, { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' });
try {
  const projects = await call('GET', '/api/projects'); const work = projects.find(p => p.slug === 'work');
  for (const type of DOCUMENT_TYPE_VALUES) await create(`Type ${type}`, type);
  const memory = await create('Pinned memory', 'decision', 'memory');
  await call('POST', `/api/library/documents/${memory.id}/verify`, { verified: true, revision: memory.revision, as: 'audit-person' });
  await call('POST', `/api/library/documents/${memory.id}/code-refs`, { path: 'server/example.js', startLine: 1, endLine: 2, contentHash: 'f'.repeat(64), commitSha: 'a'.repeat(40) }, 201);
  await call('POST', `/api/library/documents/${memory.id}/external-refs`, { url: 'https://example.com/audit-evidence', label: 'External evidence' }, 201);
  await create('Workspace review', 'note', 'inbox', { tags: ['weekly-review'], body: '[Process Inbox](#inbox-process)' });
  await create('Loose Inbox note', 'note', 'inbox');
  const archived = await create('Archived note'); await call('DELETE', `/api/library/documents/${archived.id}`);
  const old = await create('Retired guidance'); const replacement = await create('Current guidance');
  await call('POST', `/api/library/documents/${replacement.id}/links`, { targetId: old.id, relation: 'supersedes' }, 201);
  const deprecated = await create('Deprecated guidance');
  await app.db.query("update markdown_documents set status = 'deprecated' where id = $1", [deprecated.id]);
  const task = await call('POST', '/api/tasks', { title: 'Converted capture', notes: 'Capture notes sentinel', project: 'inbox', priority: 'medium', status: 'planned' }, 201);
  await call('POST', `/api/tasks/${task.id}/checklist`, { label: 'Checklist sentinel' }, 201);
  const reviewed = await call('GET', `/api/inbox/items/task/${task.id}`);
  const converted = await call('POST', `/api/inbox/items/task/${task.id}/actions`, { operationId: randomUUID(), fingerprint: reviewed.fingerprint, action: 'reference', projectId: work.id });
  assert.equal(converted.created[0].record.verified, false);
  const response = await app.inject('/api/library/export?project=all'); assert.equal(response.statusCode, 200);
  const zip = entries(response.rawPayload);
  for (const type of DOCUMENT_TYPE_VALUES) assert.match(zip.get(`work/type-${type}.md`), new RegExp(`\ntype: ${type}\n`));
  assert.ok(zip.has('memory/pinned-memory.md')); assert.ok(zip.has('inbox/loose-inbox-note.md'));
  assert.match(zip.get('inbox/workspace-review.md'), /weekly-review/); assert.match(zip.get('inbox/workspace-review.md'), /\[Process Inbox\]\(#inbox-process\)/);
  assert.match(zip.get('work/converted-capture.md'), /Capture notes sentinel/);
  assert.match(zip.get('work/converted-capture.md'), /Checklist sentinel/);
  assert.equal(zip.has('work/archived-note.md'), false);
  assert.equal((await call('GET', `/api/library/documents/${old.id}`)).status, 'superseded');
  assert.ok(zip.has('work/retired-guidance.md')); assert.ok(zip.has('work/deprecated-guidance.md'));
  assert.match(zip.get('work/retired-guidance.md'), /status: "superseded"/);
  assert.match(zip.get('work/deprecated-guidance.md'), /status: "deprecated"/);
  const front = zip.get('memory/pinned-memory.md').split('\n---\n')[0];
  for (const field of ['id', 'verified', 'verified_at', 'verified_by', 'updated_by_agent', 'status', 'code_refs', 'external_refs']) assert.equal(new RegExp(`^${field}:`, 'm').test(front), true, `${field} preserved`);
  const imported = await call('POST', '/api/library/documents', { title: 'Imported template file', body: zip.get('work/type-template.md'), documentType: 'note', project: 'work', sourceFilename: 'type-template.md' }, 201);
  assert.equal(imported.documentType, 'note'); assert.match(imported.body, /^---\n/);
  const result = { checked: 'production SQLite route and actual ZIP bytes', entries: zip.size,
    exportedTypes: DOCUMENT_TYPE_VALUES, inboxNotesAndReviews: true, memoryContent: true,
    convertedTaskNotesAndChecklist: true, archivedDocumentExcluded: true,
    supersededAndDeprecatedLabeled: true, preservedMetadata: ['document UUID', 'verification and verifier', 'specific agent', 'lifecycle status', 'code citations', 'external references'],
    copiedTemplateImportBecomesPlainNote: true, files: [...zip.keys()].sort() };
  if (process.argv[2]) await writeFile(process.argv[2], response.rawPayload);
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
