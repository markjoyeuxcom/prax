# Mature Workspace Quality Fixture

Prax has one deterministic workspace generator for migration tests, restore drills, realistic UI
work, retrieval evaluation, and future performance measurements. It creates temporary artifacts;
generated database files are reproducible and must not be committed.

## Create a fixture

```bash
npm run fixture:quality -- \
  --profile ci \
  --output /tmp/prax-quality-ci.db
```

The command creates:

- `/tmp/prax-quality-ci.db` — a fully migrated SQLite workspace.
- `/tmp/prax-quality-ci.db.manifest.json` — the versioned semantic manifest.

Generation refuses to overwrite either file. Add `--force` only when replacing those exact
artifacts is intentional.

The defaults are deliberately stable:

- Clock: `2026-07-13T12:00:00.000Z`
- Random seed: `20260713`
- Profile: `ci`

`--clock <ISO-8601>` and `--seed <uint32>` create intentional variants. Both values are recorded
in the manifest.

## Profiles

| Profile | Intended use | Scale |
|---|---|---|
| `ci` | Correctness, migration, portable round trips | 200 tasks, 50 documents, 80 document links, 20 runs and representative related rows |
| `large` | UI/API performance and authoritative restore drills | 5,000 tasks, 750 documents, 1,000 document links, 250 runs and representative related rows |

The current-schema fixture covers every task status/priority/recurrence form, dated/undated and
snoozed/timed tasks, labels, notes, checklists, activity, archives, Unicode and long text. It also
covers every document type, trust/lifecycle state, links and backlinks, stale derivations,
supersession, external references, and run histories in every status.

Optional deterministic embeddings are available without an external model:

```bash
npm run fixture:quality -- \
  --profile ci \
  --output /tmp/prax-quality-embeddings.db \
  --embeddings
```

These vectors use the reserved fixture backend/model names `quality-fixture` and
`deterministic-v1`. On the current schema their `embedded_hash` is the document **revision**
(the token over title + body), because a vector describes the whole embedded input; the
body-only content hash is used only when generating a historical (pre-revision) fixture.

## Manifest and verification

The manifest format is `prax.quality-fixture`, version 1. It records:

- source and final migration versions;
- fixed clock, seed, profile, and enabled schema features;
- exact counts for every primary/related table;
- distributions across task/document/run states;
- stable semantic sentinels for Unicode/long text, archives, taxonomy, FTS, task-document links,
  stale document links, runs, and external references.

Generation runs the verifier before publishing the manifest. Run the same verification after
copying, backing up, or restoring the database:

```bash
npm run fixture:quality -- \
  --verify \
  --output /tmp/restored.db \
  --manifest /tmp/prax-quality-ci.db.manifest.json
```

The verifier fails on count drift, semantic sentinel changes, missing FTS content, missing related
rows, incorrect migration history, or foreign-key violations. A matching row count alone is not
considered a successful restore.

## Historical-schema generation

Use `--through` to apply real migrations only through a declared ordinal or exact filename:

```bash
npm run fixture:quality -- \
  --profile ci \
  --output /tmp/prax-quality-0009.db \
  --through 0009
```

Add `--upgrade` to seed at that version and then run the remaining production migrations:

```bash
npm run fixture:quality -- \
  --profile ci \
  --output /tmp/prax-quality-upgraded.db \
  --through 0009 \
  --upgrade
```

The `0009` case deliberately crosses the `0010` document taxonomy table rebuild. Verification
proves document bodies/hashes, the FTS sentinel, task-document links, document links, and runbook
snapshots/event chronicles survive. Rows belonging to newer features are not fabricated after upgrade; for example,
a workspace seeded at `0009` has zero external references after `0011`, and the manifest says so.

Unknown migration boundaries fail immediately. Historical schemas are always constructed from
the checked-in forward migration chain—never from copied SQL or committed database binaries.

## Using an artifact

Start Prax against a generated database:

```bash
HOST=127.0.0.1 PORT=3100 PRAX_DB_FILE=/tmp/prax-quality-ci.db npm start
```

Use a fresh generated artifact for each destructive drill. The generator is the source of truth;
the database is disposable evidence.

## Candidate performance baseline

Measure the production HTTP and browser paths against a freshly generated `large` fixture:

```bash
npm run measure:performance
```

The command owns an ephemeral loopback server and Chromium session. It records repeated p50/p95
HTTP reads, browser feedback/completion journeys, startup/setup timing, Node RSS/CPU, database
size, fixture identity, and the local runtime/hardware description in a versioned JSON report.
Use `--output /safe/path/report.json` to retain that report or `--profile ci --samples 3 --warmups
1` for a quick harness rehearsal.

Every raw report says `candidate-baseline-only`. These measurements expose regressions and provide
the data needed to choose a threshold; they do not become release budgets until the reference
hardware and the human excellence boundary are agreed and recorded in an activated surface
scorecard. Budget approval is deliberately held in a separate manifest so the harness cannot
self-authorize its output.

The refreshed 2026-07-14 reference run used the default 3 warm-ups and 11 samples on the Linux
arm64 OrbStack reference, Node v24.18.0, Chromium 149.0.7827.0, 14 logical CPUs, and 21.0 GB
reported memory. Against 5,000 tasks and 750 documents it recorded these values alongside the
human-approved boundary:

| Measurement | Candidate p95 | Proposed p95 boundary |
|---|---:|---:|
| Projects HTTP | 4.55 ms | 10 ms |
| All 5,000 tasks HTTP | 31.59 ms | 60 ms |
| Task search HTTP | 4.24 ms | 10 ms |
| All 750 Library documents HTTP | 7.21 ms | 20 ms |
| Document detail HTTP | 2.09 ms | 10 ms |
| Browser shell feedback | 479.13 ms | 750 ms |
| Browser task-collection completion | 599.73 ms | 900 ms |
| Browser quick-capture feedback | 42.38 ms | 150 ms |
| Browser Library completion | 872.08 ms | 1,250 ms |
| Browser editor completion | 1,075.51 ms | 1,500 ms |

Fixture generation was 279.53 ms, app readiness 37.39 ms, database size 7,483,392 bytes, and the
measurement-process RSS moved from 184,467,456 to 416,817,152 bytes. The raw report is
[`2026-07-14-linux-arm64-candidate.json`](quality-evidence/performance/2026-07-14-linux-arm64-candidate.json)
and the explicit human-approved manifest is
[`2026-07-14-linux-arm64-budget.json`](quality-evidence/performance/2026-07-14-linux-arm64-budget.json).
The first instrumented run exposed eager DOM mounting, repeated editor hydration, duplicate startup
renders, and overlay-wide rerenders; the refreshed table records the corrected implementation.

Run a fresh reference-hardware gate with:

```bash
npm run gate:performance
```

The first post-approval fresh run on 2026-07-14 correctly failed rather than accepting the
committed candidate: Library p50 was 862.93 ms against the approved 850 ms boundary. Every other
threshold and reference check passed. Performance activation remains held until the product meets
that boundary or the human owner explicitly approves a revised one; rerunning until a lucky pass
does not close the failure.

## Portable task round-trip drill

Run the complete `moomora.tasks` v1 portability journey with:

```bash
npm run verify:portable
```

The drill generates a temporary `ci` source workspace, exports all 200 tasks through the
production HTTP route, imports them into a new project in a fresh instance, exports that target,
and compares every declared portable field plus checklist label/completion/order. Runtime task and
checklist IDs and timestamps are deliberately regenerated; every project is deliberately remapped
to the selected target project. The report pins task/checklist/archive counts and a deterministic
portable-semantics digest. Library Markdown export is one-way and is not included.

## Authoritative backup and restore drill

Run the destructive database-level recovery journey with:

```bash
npm run verify:restore
```

The primary scenario generates the `large` profile, boots the production app, commits a marker,
observes active WAL bytes, and creates an online SQLite backup from a second connection. It runs
integrity, foreign-key, and full manifest verification before deleting anything. It then destroys
the owned source database and sidecars, restores the backup into the same path, runs migrations,
re-verifies all semantic sentinels, confirms the live marker, and boots the restored production
app.

The second scenario repeats the destructive restore with a `ci` backup seeded through migration
`0009`, applies `0010` and `0011`, and verifies the deterministic upgraded manifest. This exercises
the document taxonomy/FTS table rebuild and preservation of task/document links and run history.
All destructive paths are beneath a unique temporary directory. Pass `--keep` to retain the
generated databases and report their directory; pass `--profile ci` for a quicker local rehearsal.
