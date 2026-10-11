// Fixture library + eval cases for retrieval-recall regression testing.
// Each document has a stable `key`; each case asserts which keys a query must
// retrieve (expect) and must NOT (notExpect). Realistic SRE content so the
// queries resemble what people actually ask. Retrieval runs through the real
// FTS keyword path + the context pack — the Ask Prax fallback pipeline — so a
// regression there (tokenization, ranking, the pack's filters) fails CI.

export const DOCS = [
  {
    key: 'pg-failover', title: 'Postgres primary failover', documentType: 'runbook', verified: true, tags: ['postgres', 'database'],
    body: 'Promote the hot standby when the primary is unhealthy. Target RTO 10 minutes. Stop writes at PgBouncer, run pg_ctl promote, repoint the pooler at the new primary, and verify writes succeed.',
  },
  {
    key: 'pg-restore', title: 'Restore Postgres from a base backup', documentType: 'runbook', verified: true, tags: ['postgres', 'backup'],
    body: 'Recover the cluster from a WAL-G base backup and replay archived WAL to a point in time. Validate row counts against a known checkpoint before repointing traffic.',
  },
  {
    key: 'redis-oom', title: 'Redis out of memory', documentType: 'note', verified: true, tags: ['redis'],
    body: 'When Redis reaches maxmemory it evicts keys per the eviction policy. Check maxmemory-policy, raise the limit, or shard the keyspace. Watch used_memory and evicted_keys.',
  },
  {
    key: 'cert-rotation', title: 'Rotate TLS certificates', documentType: 'runbook', verified: true, tags: ['tls', 'security'],
    body: 'Renew and roll the ingress certificates before expiry. Issue via cert-manager, verify the chain, and reload the gateway so the new leaf is served.',
  },
  {
    key: 'k8s-node', title: 'Kubernetes node NotReady', documentType: 'runbook', verified: true, tags: ['kubernetes'],
    body: 'A node goes NotReady under disk pressure. Cordon and drain it, clear the disk or replace the node, then uncordon. Watch for pods stuck Terminating on the bad node.',
  },
  {
    key: 'pgbouncer-pool', title: 'PgBouncer connection pool exhaustion', documentType: 'runbook', verified: true, tags: ['postgres'],
    body: 'Clients time out waiting for a server connection. Raise default_pool_size, find the long-running transactions holding connections open, and consider transaction pooling mode.',
  },
  {
    key: 'oncall-note', title: 'Incident response basics', documentType: 'note', verified: false, tags: ['incident'],
    body: 'Declare the incident, assign an incident commander, open a dedicated channel, and keep a running timeline. Communicate status to stakeholders regularly.',
  },
  // Junk: an empty scratch doc. FTS can match its title, but the context pack's
  // substantive filter must keep it out of every result.
  { key: 'empty-scratch', title: 'Test 3', documentType: 'note', verified: true, tags: [], body: '' },
];

export const CASES = [
  { name: 'postgres failover by intent', query: 'postgres primary failover', expect: ['pg-failover'], notExpect: ['redis-oom', 'k8s-node'] },
  { name: 'restore from backup', query: 'restore postgres backup', expect: ['pg-restore'], notExpect: ['pg-failover'] },
  { name: 'redis memory pressure', query: 'redis out of memory', expect: ['redis-oom'], notExpect: ['pg-failover'] },
  { name: 'rotate certificates', query: 'rotate tls certificates', expect: ['cert-rotation'] },
  { name: 'kubernetes node not ready', query: 'kubernetes node NotReady disk pressure', expect: ['k8s-node'], notExpect: ['pg-failover'] },
  // Title-vs-body: "PgBouncer" is in pgbouncer-pool's TITLE (and pg-failover's
  // body); the pool-exhaustion query must return the title match. Guards the
  // "title-vs-body miss" regression class.
  { name: 'title-term retrieval (PgBouncer pool)', query: 'PgBouncer pool exhaustion', expect: ['pgbouncer-pool'] },
  // The empty scratch doc must never surface, even though "Test" matches its title.
  { name: 'junk doc stays out of results', query: 'Test', expect: [], notExpect: ['empty-scratch'] },
];

// ---- Budgeted context and the since-last-session delta -------------------
// (docs/design/budgeted-context-and-brief.md)
// Keyword mode, no embedder: the fixture memory is retrieved through the FTS
// path, filled by `prax context --budget`'s own code (cli/lib/context.js) and
// the delta runs through the real changes repository. `cite` pins lines of a
// fake checkout file: `current` is what the checkout holds now.
export const MEMORY_DOCS = [
  {
    key: 'mem-verified', title: 'Backup rotation policy', documentType: 'decision', verified: true, updatedAt: '2025-11-01T00:00:00.000Z',
    body: 'Keep seven daily backup snapshots and four weekly ones. Older backup sets are pruned by the rotation job.',
  },
  {
    key: 'mem-cited', title: 'Backup script location', documentType: 'reference', verified: false, updatedAt: '2025-06-01T00:00:00.000Z',
    body: 'The backup script lives in scripts/backup.sh and writes to the NAS share.',
    cite: { path: 'scripts/backup.sh', pinned: 'rsync -a /data /nas/backup\n', current: 'rsync -a /data /nas/backup\n' },
  },
  {
    key: 'mem-stale-cite', title: 'Backup cron schedule', documentType: 'note', verified: false, updatedAt: '2026-02-01T00:00:00.000Z',
    body: 'The backup cron runs at 02:00 every night.',
    cite: { path: 'deploy/cron.txt', pinned: '0 2 * * * backup\n', current: '30 3 * * * backup\n' },
  },
  {
    key: 'mem-recent', title: 'Backup failures last week', documentType: 'note', verified: false, updatedAt: '2026-09-20T00:00:00.000Z',
    body: 'Two backup runs failed on the full NAS volume; pruning fixed it.',
  },
  {
    key: 'mem-old', title: 'Backup notes from the migration', documentType: 'note', verified: false, updatedAt: '2025-01-01T00:00:00.000Z',
    body: `Backup notes. ${'The old backup host was retired during the migration. '.repeat(12)}`,
  },
];

// `expectOrder`: the fill order of every candidate. `expectForms`: the form
// each key must print in ('full' | 'compact' | 'omitted'); keys not listed are
// unconstrained. Every case also asserts that every printed entry line carries
// a trust chip and that the budget is honoured when anything was left out.
export const BUDGET_CASES = [
  {
    name: 'budget: fill order is verified, cited-and-unchanged, then recent',
    query: 'backup',
    budget: 5000,
    expectOrder: ['mem-verified', 'mem-cited', 'mem-recent', 'mem-stale-cite', 'mem-old'],
    expectForms: { 'mem-verified': 'full', 'mem-cited': 'full', 'mem-recent': 'full', 'mem-stale-cite': 'full', 'mem-old': 'full' },
  },
  {
    name: 'budget: a tight budget keeps verified in full, compacts, and leaves out the oldest unverified',
    query: 'backup',
    budget: 240,
    expectOrder: ['mem-verified', 'mem-cited', 'mem-recent', 'mem-stale-cite', 'mem-old'],
    expectForms: { 'mem-verified': 'full', 'mem-cited': 'full', 'mem-stale-cite': 'compact', 'mem-old': 'omitted' },
    expectCompacted: true,
  },
];

// The delta: every fixture memory is pinned at T0, then these changes happen
// after `DELTA_SINCE`. `create` adds a new memory; `supersede` retires `key`
// in favour of `by`.
export const DELTA_T0 = '2026-01-01T00:00:00.000Z';
export const DELTA_SINCE = '2026-06-01T00:00:00.000Z';
export const DELTA_EVENTS = [
  { at: '2026-07-01T00:00:00.000Z', create: { key: 'delta-new', title: 'Backup cron moved to 03:30', body: 'The backup cron now runs at 03:30.', verified: false } },
  { at: '2026-07-02T00:00:00.000Z', update: 'mem-old', body: 'Backup notes, trimmed.' },
  { at: '2026-07-03T00:00:00.000Z', verify: 'mem-recent' },
  { at: '2026-07-04T00:00:00.000Z', supersede: 'mem-stale-cite', by: 'delta-new' },
];
export const DELTA_CASES = [
  {
    name: 'delta: only memory changed since the marker, with what changed',
    since: DELTA_SINCE,
    expect: { 'delta-new': ['created'], 'mem-old': ['updated'], 'mem-recent': ['verified'], 'mem-stale-cite': ['superseded'] },
    notExpect: ['mem-verified', 'mem-cited'],
    expectFirst: 'mem-recent',
  },
  {
    name: 'delta: a window after the last change is empty',
    since: '2026-08-01T00:00:00.000Z',
    expect: {},
    notExpect: ['delta-new', 'mem-old', 'mem-recent', 'mem-stale-cite', 'mem-verified', 'mem-cited'],
  },
  {
    name: 'delta: a window that starts mid-way sees only the later changes',
    since: '2026-07-02T12:00:00.000Z',
    expect: { 'mem-recent': ['verified'], 'mem-stale-cite': ['superseded'] },
    notExpect: ['delta-new', 'mem-old'],
  },
];
