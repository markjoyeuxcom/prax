import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFrontMatter,
  renderDocumentMarkdown,
  documentFilename,
  dedupeFilenames,
  libraryArchiveFilename,
} from '../../server/libraryExport.js'

const BASE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  projectId: 'pid',
  tags: ['postgres', 'dr'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
}

test('formatFrontMatter emits all six fields with block-sequence tags', () => {
  const fm = formatFrontMatter(BASE_DOC, 'homelab')
  assert.match(fm, /^---\n/)
  assert.match(fm, /\n---\n$/)
  assert.match(fm, /\ntitle: Postgres restore\n/)
  assert.match(fm, /\ntype: runbook\n/)
  assert.match(fm, /\nproject: homelab\n/)
  assert.match(fm, /\ntags:\n  - postgres\n  - dr\n/)
  assert.match(fm, /\ncreated_at: 2026-04-12T10:33:21\.000Z\n/)
  assert.match(fm, /\nupdated_at: 2026-05-20T08:11:09\.000Z\n/)
})

test('formatFrontMatter renders empty tag list as tags: []', () => {
  const fm = formatFrontMatter({ ...BASE_DOC, tags: [] }, 'homelab')
  assert.match(fm, /\ntags: \[\]\n/)
  assert.doesNotMatch(fm, /\n  - /)
})

test('formatFrontMatter double-quotes titles with YAML-significant chars', () => {
  const cases = [
    { title: 'Has: colon', expect: '"Has: colon"' },
    { title: 'Has "quote"', expect: '"Has \\"quote\\""' },
    { title: 'Back\\slash', expect: '"Back\\\\slash"' },
    { title: '- leading dash', expect: '"- leading dash"' },
    { title: 'line1\nline2', expect: '"line1\\nline2"' },
    { title: '#heading', expect: '"#heading"' },
  ]
  for (const { title, expect } of cases) {
    const fm = formatFrontMatter({ ...BASE_DOC, title }, 'homelab')
    assert.match(fm, new RegExp(`\\ntitle: ${expect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`))
  }
})

test('formatFrontMatter falls back to "unknown" when project slug is missing', () => {
  const fm = formatFrontMatter(BASE_DOC, '')
  assert.match(fm, /\nproject: unknown\n/)
})

test('formatFrontMatter quotes tags with YAML-significant chars in the block sequence', () => {
  const fm = formatFrontMatter({ ...BASE_DOC, tags: ['#urgent', 'has: colon'] }, 'homelab')
  assert.match(fm, /\n  - "#urgent"\n/)
  assert.match(fm, /\n  - "has: colon"\n/)
})

test('formatFrontMatter quotes type and project values containing YAML-significant chars', () => {
  const fm = formatFrontMatter({ ...BASE_DOC, documentType: 'has: colon' }, 'weird: slug')
  assert.match(fm, /\ntype: "has: colon"\n/)
  assert.match(fm, /\nproject: "weird: slug"\n/)
})

test('renderDocumentMarkdown writes front-matter, blank line, body, single trailing newline', () => {
  const out = renderDocumentMarkdown(BASE_DOC, 'homelab')
  assert.ok(out.startsWith('---\n'))
  assert.ok(out.includes('\n---\n\n# Postgres restore\n'))
  assert.ok(out.endsWith('\n'))
  assert.ok(!out.endsWith('\n\n'))
})

test('renderDocumentMarkdown with empty body ends with exactly one newline', () => {
  const out = renderDocumentMarkdown({ ...BASE_DOC, body: '' }, 'homelab')
  assert.ok(out.endsWith('---\n'))
  assert.ok(!out.endsWith('---\n\n'))
})

test('renderDocumentMarkdown preserves body containing literal --- lines', () => {
  const body = 'before\n---\nafter\n'
  const out = renderDocumentMarkdown({ ...BASE_DOC, body }, 'homelab')
  assert.ok(out.endsWith('before\n---\nafter\n'))
})

test('renderDocumentMarkdown appends a trailing newline if body lacks one', () => {
  const out = renderDocumentMarkdown({ ...BASE_DOC, body: 'no newline' }, 'homelab')
  assert.ok(out.endsWith('no newline\n'))
})

test('documentFilename uses sanitized source_filename when present', () => {
  const name = documentFilename({ ...BASE_DOC, sourceFilename: 'runbooks/restore.md' })
  assert.equal(name, 'restore.md')
})

test('documentFilename appends .md when source_filename lacks the extension', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: 'restore' }), 'restore.md')
})

test('documentFilename strips path traversal segments', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '../../etc/passwd' }), 'passwd.md')
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '..\\foo.md' }), 'foo.md')
})

test('documentFilename slugifies the title when source_filename is missing', () => {
  assert.equal(
    documentFilename({ ...BASE_DOC, sourceFilename: null, title: 'Postgres Restore — Steps' }),
    'postgres-restore-steps.md',
  )
})

test('documentFilename falls back to untitled.md for empty/whitespace input', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: null, title: '   ' }), 'untitled.md')
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '   ', title: '' }), 'untitled.md')
})

test('dedupeFilenames suffixes collisions within the same path prefix', () => {
  const entries = [
    { path: '', filename: 'foo.md' },
    { path: '', filename: 'foo.md' },
    { path: '', filename: 'foo.md' },
    { path: 'work/', filename: 'foo.md' },
  ]
  dedupeFilenames(entries)
  assert.deepEqual(entries.map(e => `${e.path}${e.filename}`), [
    'foo.md', 'foo-2.md', 'foo-3.md', 'work/foo.md',
  ])
})

test('dedupeFilenames probes past pre-existing suffixed entries', () => {
  const entries = [
    { path: 'proj/', filename: 'foo.md' },
    { path: 'proj/', filename: 'foo-2.md' },
    { path: 'proj/', filename: 'foo.md' },
  ]
  dedupeFilenames(entries)
  assert.deepEqual(entries.map(e => `${e.path}${e.filename}`), [
    'proj/foo.md', 'proj/foo-2.md', 'proj/foo-3.md',
  ])
})

test('libraryArchiveFilename emits per-project name with date', () => {
  const date = new Date('2026-05-28T12:00:00.000Z')
  assert.equal(libraryArchiveFilename('homelab', date), 'moomora-console-library-homelab-2026-05-28.zip')
})

test('libraryArchiveFilename emits all-projects name with date', () => {
  const date = new Date('2026-05-28T12:00:00.000Z')
  assert.equal(libraryArchiveFilename('all', date), 'moomora-console-library-all-2026-05-28.zip')
})
