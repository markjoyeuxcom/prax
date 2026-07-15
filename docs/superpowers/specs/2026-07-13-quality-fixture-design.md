# Mature Workspace Quality Fixture — Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Quality standard:** [Exceptional Prax](./2026-07-13-exceptional-prax-quality-standard.md)

## Goal

Create one deterministic, reviewable workspace generator that becomes the common foundation for
migration evidence, portable round trips, backup/restore drills, realistic UI journeys,
retrieval evaluation, and future performance budgets. No generated database binary is committed.

## Artifact contract

One invocation creates:

1. A SQLite database at an explicitly supplied output path.
2. A neighbouring JSON manifest (`<database>.manifest.json` by default).

The manifest is versioned as `prax.quality-fixture` v1 and records the profile, fixed clock,
random seed, source/final schema migrations, enabled features, exact expected row counts, and
semantic sentinel records. Generation verifies those expectations before publishing the
manifest. The same verifier can validate a copied/restored database later.

All workspace IDs, timestamps, content hashes, selections, and generated content are
deterministic for the same inputs. Migration bookkeeping timestamps are not treated as workspace
content and are excluded from the semantic manifest.

## Profiles

| Profile | Tasks | Documents | Document links | Runs | Supporting rows |
|---|---:|---:|---:|---:|---|
| `ci` | 200 | 50 | 80 | 20 | 150 checklist items, 300 activity events, 100 task-document links, 20 external refs, 4 steps/run |
| `large` | 5,000 | 750 | 1,000 | 250 | 3,750 checklist items, 7,500 activity events, 1,500 task-document links, 300 external refs, 5 steps/run |

Run and external-reference counts are zero when the selected source schema predates those
tables. This is explicit in the manifest rather than silently synthesized after an upgrade.

## Coverage

The current-schema fixture contains:

- every task status and priority;
- past/today/future/no due dates, due times, past/future snoozes, all recurrence forms, labels,
  notes, checklists, activity, archived tasks, long text, punctuation, and Unicode;
- every document type, source/synthesized kinds, verified/unverified trust, every lifecycle
  status, archived documents, task links, links/backlinks, stale and fresh derivations,
  supersession edges, external references, and runbook runs in every status;
- optional deterministic embeddings whose hash/model metadata is internally coherent;
- fixed sentinel records whose field meanings—not just table counts—are verified.

Generated relationships remain lifecycle-coherent: supersession targets are superseded,
derived-from sources are synthesized documents, and run records point to runbooks.

## Historical schemas

The migration runner gains a `through` boundary that accepts a real migration filename or
ordinal. Fixture generation can:

1. Apply migrations only through that declared version.
2. Seed only the fields/tables available at that version.
3. Optionally apply the remaining real migrations with `--upgrade`.
4. Verify the original semantic sentinels and related rows against the final schema.

This deliberately exercises the production migration chain. It does not copy old SQL into the
fixture, mutate `schema_migrations` by hand, or commit opaque historical databases. In
particular, the automated `0009` → current case crosses the `0010` document-table rebuild and
proves documents, FTS content, task links, document links, and runbook history survive.

## CLI

```text
npm run fixture:quality -- --profile ci --output /tmp/prax-quality-ci.db
npm run fixture:quality -- --profile ci --output /tmp/prax-upgrade.db --through 0009 --upgrade
npm run fixture:quality -- --verify --output /tmp/restored.db --manifest /tmp/prax-quality-ci.db.manifest.json
```

Generation refuses to overwrite an existing database or manifest unless `--force` is explicit.
`--embeddings` enables deterministic fixture vectors. `--clock` and `--seed` are available for
intentional variants, with stable defaults used by CI.

## Verification

- Unit-test migration boundaries and invalid versions.
- Generate and verify the current `ci` fixture with embeddings.
- Generate at `0009`, upgrade through current, and verify semantic preservation and migration
  bookkeeping.
- Smoke-generate and verify the `large` profile outside the ordinary fast test suite.
- Run `npm test`, `npm run check`, and `git diff --check`.
