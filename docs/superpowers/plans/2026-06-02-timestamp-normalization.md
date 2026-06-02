# Timestamp normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every JSON timestamp field exposed by the HTTP API and the library
export emit ISO-8601 strings, matching what the contract documents already promise.
Today Postgres TIMESTAMPTZ columns flow through normalizers as JS `Date` objects and
are stringified via `Date.prototype.toString()` whenever interpolated into Markdown
front-matter or other templates.

**Architecture:** Add a single tiny helper `toIso(value)` in a new
`server/columnTypes.js`. Wrap every timestamp field in five normalizers
(`normalizeDocumentRow`, `normalizeTaskRow`, `normalizeActivityRow`,
`normalizeProjectRow`, `normalizeChecklistRow`). One focused unit-test file plus a
contract-test fixture that seeds `Date` objects locks the regression.

**Tech Stack:** Node.js + plain `pg`, Node's built-in test runner via `npm test`,
`node:test` + `node:assert/strict`.

**Spec:** [`docs/superpowers/specs/2026-06-02-timestamp-normalization-design.md`](../specs/2026-06-02-timestamp-normalization-design.md)

**Target release:** v0.11.1 (patch).

---

## File map

**Create:**
- `server/columnTypes.js` — `toIso(value)` helper.
- `tests/backend/columnTypes.test.js` — three unit tests for `toIso`.
- `tests/backend/normalizers.timestamps.test.js` — Date-input tests for all five
  normalizers.

**Modify:**
- `server/libraryRepository.js` — wrap `archivedAt`/`createdAt`/`updatedAt` in
  `normalizeDocumentRow` with `toIso`.
- `server/tasksRepository.js` — same for `normalizeTaskRow` and `normalizeActivityRow`.
- `server/projectsRepository.js` — same for `normalizeProjectRow`.
- `server/checklistRepository.js` — same for `normalizeChecklistRow`.
- `tests/contract/libraryFormat.test.js` — extend dual-write fixtures so at least one
  fixture seeds `Date` objects (locks the regression at the contract layer).

---

## Task 1 — `toIso` helper + unit tests

**Files:**
- Create: `server/columnTypes.js`
- Create: `tests/backend/columnTypes.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/columnTypes.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../../server/columnTypes.js';

test('toIso converts a Date to an ISO 8601 string', () => {
  const out = toIso(new Date('2026-06-02T19:47:21.123Z'));
  assert.equal(out, '2026-06-02T19:47:21.123Z');
});

test('toIso passes null and undefined through unchanged', () => {
  assert.equal(toIso(null), null);
  assert.equal(toIso(undefined), undefined);
});

test('toIso passes a string through unchanged', () => {
  assert.equal(toIso('2026-04-12T10:33:21.000Z'), '2026-04-12T10:33:21.000Z');
  assert.equal(toIso('not even a date'), 'not even a date');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/columnTypes.test.js`
Expected: FAIL — `server/columnTypes.js` does not exist.

- [ ] **Step 3: Create `server/columnTypes.js`**

Write the file:

```javascript
export function toIso(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/columnTypes.test.js`
Expected: PASS (3 tests).

Run: `npm test`
Expected: full suite still green (no normalizer wrapping yet; nothing depends on
`columnTypes.js` yet).

- [ ] **Step 5: Commit**

```bash
git add server/columnTypes.js tests/backend/columnTypes.test.js
git commit -m "Add toIso(value) column-type adapter

A pure helper that coerces JS Date objects to ISO 8601 strings while
passing null/undefined/strings through unchanged. Used to bridge the
pg driver's Date-returning TIMESTAMPTZ result rows to the JSON wire
form that the contract docs promise.
"
```

---

## Task 2 — Wrap timestamps in all five normalizers

**Files:**
- Modify: `server/libraryRepository.js`
- Modify: `server/tasksRepository.js`
- Modify: `server/projectsRepository.js`
- Modify: `server/checklistRepository.js`
- Create: `tests/backend/normalizers.timestamps.test.js`

- [ ] **Step 1: Write the failing normalizer tests**

Create `tests/backend/normalizers.timestamps.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';
import { normalizeTaskRow, normalizeActivityRow } from '../../server/tasksRepository.js';
import { normalizeProjectRow } from '../../server/projectsRepository.js';
import { normalizeChecklistRow } from '../../server/checklistRepository.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const D1 = new Date('2026-06-02T19:47:21.123Z');
const D2 = new Date('2026-06-02T20:00:00.000Z');

test('normalizeDocumentRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: D1, created_at: D1, updated_at: D2,
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.match(out.archivedAt, ISO);
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
  assert.equal(out.createdAt, '2026-06-02T19:47:21.123Z');
});

test('normalizeDocumentRow preserves null archived_at as null', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: D1, updated_at: D2,
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.equal(out.archivedAt, null);
});

test('normalizeDocumentRow leaves ISO-string timestamps unchanged', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null,
    created_at: '2026-04-12T10:33:21.000Z',
    updated_at: '2026-05-20T08:11:09.000Z',
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.equal(out.createdAt, '2026-04-12T10:33:21.000Z');
  assert.equal(out.updatedAt, '2026-05-20T08:11:09.000Z');
});

test('normalizeTaskRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeTaskRow({
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'medium', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 0,
    archived_at: D1, created_at: D1, updated_at: D2,
  });
  assert.match(out.archivedAt, ISO);
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});

test('normalizeTaskRow preserves null archived_at as null', () => {
  const out = normalizeTaskRow({
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'medium', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 0,
    archived_at: null, created_at: D1, updated_at: D2,
  });
  assert.equal(out.archivedAt, null);
});

test('normalizeActivityRow coerces Date created_at to ISO string', () => {
  const out = normalizeActivityRow({
    id: 'id', task_id: 'tid', event_type: 'created', message: 'msg',
    created_at: D1,
  });
  assert.match(out.createdAt, ISO);
  assert.equal(out.createdAt, '2026-06-02T19:47:21.123Z');
});

test('normalizeProjectRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeProjectRow({
    id: 'id', name: 'Homelab', slug: 'homelab', status: 'active',
    sort_order: 0, created_at: D1, updated_at: D2,
  });
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});

test('normalizeChecklistRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeChecklistRow({
    id: 'id', task_id: 'tid', label: 'do', completed: false,
    sort_order: 0, created_at: D1, updated_at: D2,
  });
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/normalizers.timestamps.test.js`
Expected: FAIL — every Date-input test fails because the normalizers currently pass
the Date through unchanged (so `out.createdAt` is a Date, not a string).

- [ ] **Step 3: Wrap timestamps in `server/libraryRepository.js`**

Edit `server/libraryRepository.js`. At the top of the file, add the import next to the
existing `import { createHash } from 'node:crypto';` line:

```javascript
import { toIso } from './columnTypes.js';
```

Update `normalizeDocumentRow` to wrap the three timestamp fields:

```javascript
export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}
```

- [ ] **Step 4: Wrap timestamps in `server/tasksRepository.js`**

Edit `server/tasksRepository.js`. Add the import near the top:

```javascript
import { toIso } from './columnTypes.js';
```

Update `normalizeTaskRow`:

```javascript
export function normalizeTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    projectId: row.project_id,
    dueDate: toDateOnly(row.due_date),
    sortOrder: row.sort_order,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
```

Update `normalizeActivityRow`:

```javascript
export function normalizeActivityRow(row) {
  return { id: row.id, taskId: row.task_id, eventType: row.event_type, message: row.message, createdAt: toIso(row.created_at) };
}
```

- [ ] **Step 5: Wrap timestamps in `server/projectsRepository.js`**

Edit `server/projectsRepository.js`. Add the import:

```javascript
import { toIso } from './columnTypes.js';
```

Update `normalizeProjectRow`:

```javascript
export function normalizeProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
```

- [ ] **Step 6: Wrap timestamps in `server/checklistRepository.js`**

Edit `server/checklistRepository.js`. Add the import at the very top:

```javascript
import { toIso } from './columnTypes.js';
```

Update `normalizeChecklistRow`:

```javascript
export function normalizeChecklistRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    completed: row.completed,
    sortOrder: row.sort_order,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- tests/backend/normalizers.timestamps.test.js`
Expected: PASS (all 8 tests).

Run: `npm test`
Expected: full suite green. (No existing tests should break: most pass ISO strings as
fixtures, and `toIso` is a no-op for strings.)

- [ ] **Step 8: Commit**

```bash
git add server/libraryRepository.js server/tasksRepository.js \
        server/projectsRepository.js server/checklistRepository.js \
        tests/backend/normalizers.timestamps.test.js
git commit -m "Coerce timestamps to ISO 8601 at every normalizer

normalizeDocumentRow, normalizeTaskRow, normalizeActivityRow,
normalizeProjectRow, and normalizeChecklistRow now wrap their
created/updated/archived fields with toIso(), so a JS Date object from
the pg driver becomes the same ISO 8601 string the contract docs
promise. Strings and null still pass through unchanged, so existing
fixtures stay compatible.
"
```

---

## Task 3 — Contract regression at the dual-write boundary

**Files:**
- Modify: `tests/contract/libraryFormat.test.js`

- [ ] **Step 1: Append a Date-typed fixture to the dual-write invariant test**

In `tests/contract/libraryFormat.test.js`, find the existing dual-write fixture
array (the `fixtures = [ ... ]` block inside the
`SHAPE: browser serializer is byte-identical to server (dual-write invariant)` test).

Append exactly one new fixture whose `createdAt` / `updatedAt` are JS `Date` objects
rather than ISO strings:

```javascript
// Date-object fixture: locks the dual-write parity for the production data path
// (the pg driver returns Date objects). The ISO conversion guarantee itself lives
// in tests/backend/normalizers.timestamps.test.js — this fixture only proves the
// two formatters AGREE on Date handling.
{
  doc: {
    ...baseDoc,
    createdAt: new Date('2026-04-12T10:33:21.000Z'),
    updatedAt: new Date('2026-05-20T08:11:09.000Z'),
  },
  slug: 'homelab',
  links: EMPTY,
},
```

The existing `assert.equal(buildExportedMarkdown(...), renderDocumentMarkdown(...))`
inside the test loop is sufficient — it asserts byte parity for whatever string form
both renderers produce when given a Date. Do NOT add new assertions in this test;
the per-normalizer ISO guarantees live in `tests/backend/normalizers.timestamps.test.js`
from Task 2.

- [ ] **Step 2: Run tests to verify**

Run: `npm test -- tests/contract/libraryFormat.test.js`
Expected: PASS. The Date-fixture round-trip works because both renderers interpolate
the value identically (`${doc.createdAt}` → JS Date toString form on both sides).

Run: `npm test`
Expected: full suite green.

- [ ] **Step 3: Commit**

```bash
git add tests/contract/libraryFormat.test.js
git commit -m "Lock dual-write parity for Date-typed timestamps

Append a fixture where createdAt and updatedAt are JS Date objects to
the contract dual-write invariant. Catches any future drift between
the server and browser formatters on the production data shape; the
ISO-conversion guarantee itself lives in normalizers.timestamps.test.js.
"
```

---

## Task 4 — Real-Postgres smoke + final review + PR

**Files:** none.

- [ ] **Step 1: Run the full suite green**

Run: `npm test` → PASS.
Run: `npm run check` → PASS.

- [ ] **Step 2: Bring up real Postgres and exercise the fix end-to-end**

```bash
docker compose down -v
docker compose up -d --build
sleep 10
```

Create a doc, list it via JSON, and export it:

```bash
PROJECT_ID=$(docker compose exec -T postgres psql -U moomora -d moomora_console -t -A -c "select id from projects limit 1")
DOC_ID=$(curl -s -X POST "http://127.0.0.1:3100/api/library/documents" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"smoke\",\"body\":\"# x\\n\",\"documentType\":\"note\",\"project\":\"$PROJECT_ID\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# 1) HTTP JSON
curl -s 'http://127.0.0.1:3100/api/library/documents' | python3 -m json.tool | grep -E 'createdAt|updatedAt' | head -4

# 2) Bulk export
curl -s -o /tmp/lib.zip 'http://127.0.0.1:3100/api/library/export'
unzip -p /tmp/lib.zip $(unzip -l /tmp/lib.zip | awk '/smoke/{print $4}') | grep -E '^created_at|^updated_at'

# 3) Single-doc export
curl -s "http://127.0.0.1:3100/api/library/documents/$DOC_ID/export" | grep -E '^created_at|^updated_at'
```

Expected: all three outputs show ISO timestamps like `2026-06-02T19:47:21.123Z`,
NOT JS Date toString form (no `GMT`, no day-of-week prefix).

Tear down:

```bash
docker compose down -v
```

- [ ] **Step 3: Dispatch a final Opus reviewer subagent**

Per `subagent-model-routing.md`: Opus for reviewers. Ask for spec compliance and
code quality across the branch. Address any **Important** findings before opening
the PR.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin fix/timestamp-normalization
gh pr create --title "fix: coerce timestamps to ISO 8601 at every normalizer" --body "$(cat <<'EOF'
## Summary

Postgres TIMESTAMPTZ columns flow through the \`pg\` driver as JS \`Date\` objects.
The five normalizers (\`normalizeDocumentRow\`, \`normalizeTaskRow\`,
\`normalizeActivityRow\`, \`normalizeProjectRow\`, \`normalizeChecklistRow\`) passed
them through unchanged, so any \${value} interpolation — including the library
\`.md\` export front-matter — emitted \`Date.toString()\` form
(\`Tue Jun 02 2026 19:47:21 GMT+0000 (Coordinated Universal Time)\`) rather than the
ISO 8601 form the contract docs promised. Most CI fixtures use ISO strings, so the
bug was invisible to the suite.

This PR adds a \`toIso(value)\` helper in a new \`server/columnTypes.js\` and wraps
every timestamp field in the five normalizers. \`null\` / \`undefined\` / strings
pass through unchanged. A new \`tests/backend/normalizers.timestamps.test.js\` unit
test exercises every normalizer with a Date input and asserts the ISO regex; a Date-
typed fixture in the contract dual-write invariant locks the production data path.

Pure correctness fix — no schema change, no wire-format change, no MCP surface
change. Cuts as **v0.11.1**.

## Test plan

- [x] \`npm test\` green
- [x] \`npm run check\` green
- [x] Real-Postgres smoke (\`docker compose up -d --build\`):
  - HTTP JSON shows ISO timestamps.
  - Bulk export \`.md\` front-matter shows ISO \`created_at\` / \`updated_at\`.
  - Single-doc export shows ISO \`created_at\` / \`updated_at\`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.11.1**. Standard ritual:

1. Branch `release-v0.11.1` from main.
2. `npm version 0.11.1 --no-git-tag-version`.
3. Update `compose.image.yaml` and the README image-tag callout to `v0.11.1`.
4. Roll `[Unreleased]` to `[0.11.1] - <today>` in `CHANGELOG.md` with a `### Fixed`
   entry: "Timestamps in HTTP responses and library `.md` exports now emit ISO 8601
   strings; previously the `pg` driver's `Date` objects rendered as
   `Date.prototype.toString()` form in any string-interpolated touchpoint. (#<PR>)"
5. Add the `v0.11.0...v0.11.1` compare link.
6. Commit, PR, merge, `git tag -a v0.11.1 -m "v0.11.1" && git push origin v0.11.1`.
7. Watch the release workflow.
