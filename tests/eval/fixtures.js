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
