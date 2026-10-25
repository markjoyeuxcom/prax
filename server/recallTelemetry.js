// Recall telemetry (librarian spec, the Prax Library document "Prax design: librarian"):
// a local-only record of the retrieval queries agent clients make, the
// documents each returned, and the documents an agent reports it used. It
// feeds the knowledge-gaps queue, the recall-frequency review order and the
// never-recalled prune candidates.
//
// Recording is best-effort by contract: callers schedule it after answering
// and swallow every failure (see recordQueryLater), so telemetry can never
// slow or fail a recall. Growth is bounded by age and by row count.
import { foldCase } from './db.js';
import { redactSecrets } from './secretPatterns.js';

export const QUERY_SOURCES = Object.freeze(['recall', 'search', 'context', 'mcp', 'assistant']);
export const QUERY_MODES = Object.freeze(['semantic', 'hybrid', 'keyword', 'recency']);
export const RETENTION_DAYS = 90;
export const MAX_QUERY_ROWS = 20000;
export const MAX_USE_ROWS = 20000;
export const MAX_HITS_PER_QUERY = 50;
export const MAX_QUERY_CHARS = 500;
export const PRUNE_EVERY = 50;
// A used signal within this window after a query answers it.
export const USED_WINDOW_HOURS = 24;
export const GAPS_LIMIT = 50;
export const PRUNE_MIN_AGE_DAYS = 30;

const DAY_MS = 86400000;

// The header an agent client sets to have a retrieval recorded; anything else
// (the web UI sends nothing) is not recorded.
export const QUERY_SOURCE_HEADER = 'x-prax-query-source';

export function querySourceFrom(headers = {}) {
  const raw = headers[QUERY_SOURCE_HEADER];
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  return QUERY_SOURCES.includes(value) ? value : null;
}

// The query text as stored: credential spans redacted (an agent may paste a
// token into a search), then trimmed and capped. Redaction runs on the whole
// query before the cap, so a secret straddling the cut is still recognised.
export function storedQueryText(query) {
  return redactSecrets(String(query ?? '').trim()).trim().slice(0, MAX_QUERY_CHARS);
}

// Case-folded letter/digit runs joined by one space: "Postgres  backup?" and
// "postgres backup" are the same question for aggregation.
export function normalizeQueryKey(query) {
  const words = foldCase(String(query ?? '')).match(/[\p{L}\p{N}]+/gu) || [];
  return words.join(' ').slice(0, MAX_QUERY_CHARS);
}

function iso(date) {
  return new Date(date).toISOString();
}

function daysAgo(now, days) {
  return iso(new Date(now).getTime() - days * DAY_MS);
}

function uniqueIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_HITS_PER_QUERY) break;
  }
  return out;
}

// Pure: group recorded query rows into the gaps queue. `rows` carry
// { occurredAt, query, queryKey, agent, source, hitCount, used }; newest first
// or any order. A group answered by any used signal is not a gap. Otherwise a
// latest occurrence with no hits is a `no-hits` gap; one whose hits were never
// used is an `unused` gap, but only when used signals exist at all and the
// window for a use has closed — without used signals every query would look
// unanswered.
export function aggregateGaps(rows, {
  now = new Date(), usedSignals = 0, windowHours = USED_WINDOW_HOURS, limit = GAPS_LIMIT,
} = {}) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.queryKey) continue;
    let group = groups.get(row.queryKey);
    if (!group) {
      group = { queryKey: row.queryKey, occurrences: 0, answered: false, latest: null, agents: new Set(), sources: new Set() };
      groups.set(row.queryKey, group);
    }
    group.occurrences += 1;
    if (row.used) group.answered = true;
    if (row.agent) group.agents.add(row.agent);
    if (row.source) group.sources.add(row.source);
    if (!group.latest || String(row.occurredAt) > String(group.latest.occurredAt)) group.latest = row;
  }
  const windowStart = new Date(now).getTime() - windowHours * 3600000;
  const gaps = [];
  for (const group of groups.values()) {
    if (group.answered) continue;
    const latest = group.latest;
    let reason = null;
    if (Number(latest.hitCount) === 0) reason = 'no-hits';
    else if (usedSignals > 0 && Date.parse(latest.occurredAt) <= windowStart) reason = 'unused';
    if (!reason) continue;
    gaps.push({
      query: latest.query,
      queryKey: group.queryKey,
      reason,
      occurrences: group.occurrences,
      lastAskedAt: latest.occurredAt,
      lastHitCount: Number(latest.hitCount) || 0,
      agents: [...group.agents].sort(),
      sources: [...group.sources].sort(),
    });
  }
  gaps.sort((a, b) => b.occurrences - a.occurrences || String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  return gaps.slice(0, limit);
}

export function createRecallTelemetry(db, {
  enabled = true,
  retentionDays = RETENTION_DAYS,
  maxQueryRows = MAX_QUERY_ROWS,
  maxUseRows = MAX_USE_ROWS,
  pruneEvery = PRUNE_EVERY,
  clock = () => new Date(),
} = {}) {
  let insertsSincePrune = 0;

  async function maybePrune() {
    insertsSincePrune += 1;
    if (insertsSincePrune < pruneEvery) return;
    insertsSincePrune = 0;
    await prune();
  }

  async function prune(now = clock()) {
    const cutoff = daysAgo(now, retentionDays);
    const oldQueries = await db.query('delete from recall_queries where occurred_at < $1 returning id', [cutoff]);
    const oldUses = await db.query('delete from recall_uses where occurred_at < $1 returning id', [cutoff]);
    // Row caps: keep the newest `max` rows (ids are monotonic).
    const capQueries = await db.query(
      `delete from recall_queries where id <= (
         select id from recall_queries order by id desc limit 1 offset $1
       ) returning id`,
      [maxQueryRows],
    );
    const capUses = await db.query(
      `delete from recall_uses where id <= (
         select id from recall_uses order by id desc limit 1 offset $1
       ) returning id`,
      [maxUseRows],
    );
    return {
      queries: oldQueries.rows.length + capQueries.rows.length,
      uses: oldUses.rows.length + capUses.rows.length,
    };
  }

  return {
    enabled,

    // One query event and its hits, in one session transaction. Hit ids that
    // name no document (deleted meanwhile) are skipped rather than failing.
    async recordQuery({ source, mode, query, agent = null, projectId = null, hitIds = [], hitCount } = {}) {
      if (!enabled) return null;
      if (!QUERY_SOURCES.includes(source)) throw new Error(`unknown query source: ${source}`);
      if (!QUERY_MODES.includes(mode)) throw new Error(`unknown query mode: ${mode}`);
      // Never the verbatim query: the grouping key is computed from the
      // redacted text too, so no secret survives in either column.
      const text = storedQueryText(query);
      const key = normalizeQueryKey(text);
      if (!key) return null;
      const ids = uniqueIds(hitIds);
      const count = Number.isInteger(hitCount) && hitCount >= 0 ? hitCount : ids.length;
      const client = await db.connect();
      let id;
      try {
        await client.query('begin immediate');
        try {
          const inserted = await client.query(
            `insert into recall_queries (occurred_at, source, mode, query, query_key, agent, project_id, hit_count)
             values ($1, $2, $3, $4, $5, $6,
               (select id from projects where id = $7), $8)
             returning id`,
            [iso(clock()), source, mode, text, key, agent || null, projectId || null, count],
          );
          id = inserted.rows[0].id;
          if (ids.length) {
            await client.query(
              `insert or ignore into recall_query_hits (query_id, document_id, rank)
               select $1, j.value, j.key + 1 from json_each($2) j
               where exists (select 1 from markdown_documents d where d.id = j.value)`,
              [id, JSON.stringify(ids)],
            );
          }
          await client.query('commit');
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
      await maybePrune();
      return id;
    },

    async recordUse({ documentId, agent = null, source = 'cli' } = {}) {
      const result = await db.query(
        `insert into recall_uses (occurred_at, document_id, agent, source) values ($1, $2, $3, $4)
         returning id, occurred_at`,
        [iso(clock()), documentId, agent || null, String(source || 'cli').slice(0, 32)],
      );
      await maybePrune();
      const row = result.rows[0];
      return { id: row.id, documentId, agent: agent || null, occurredAt: row.occurred_at };
    },

    prune,

    async clear() {
      const queries = await db.query('delete from recall_queries returning id');
      const uses = await db.query('delete from recall_uses returning id');
      return { queries: queries.rows.length, uses: uses.rows.length };
    },

    async stats() {
      const q = (await db.query('select count(*) as n, min(occurred_at) as oldest, max(occurred_at) as newest from recall_queries')).rows[0] || {};
      const u = (await db.query('select count(*) as n, min(occurred_at) as oldest from recall_uses')).rows[0] || {};
      return {
        enabled,
        queries: Number(q.n || 0),
        uses: Number(u.n || 0),
        oldestAt: [q.oldest, u.oldest].filter(Boolean).sort()[0] || null,
        newestAt: q.newest || null,
        retentionDays,
        maxQueryRows,
        maxUseRows,
      };
    },

    // Per-document hit and use counts over the retention window.
    async recallCounts({ now = clock() } = {}) {
      const since = daysAgo(now, retentionDays);
      const hits = await db.query(
        `select h.document_id, count(*) as hits, max(q.occurred_at) as last
         from recall_query_hits h join recall_queries q on q.id = h.query_id
         where q.occurred_at >= $1 group by h.document_id`,
        [since],
      );
      const uses = await db.query(
        'select document_id, count(*) as uses from recall_uses where occurred_at >= $1 group by document_id',
        [since],
      );
      const counts = {};
      for (const row of hits.rows) {
        counts[row.document_id] = { hits: Number(row.hits), uses: 0, lastRecalledAt: row.last || null };
      }
      for (const row of uses.rows) {
        counts[row.document_id] ??= { hits: 0, uses: 0, lastRecalledAt: null };
        counts[row.document_id].uses = Number(row.uses);
      }
      return { counts, since };
    },

    async gaps({ now = clock(), limit = GAPS_LIMIT } = {}) {
      const since = daysAgo(now, retentionDays);
      const rows = await db.query(
        `select q.occurred_at, q.query, q.query_key, q.agent, q.source, q.hit_count,
           exists (
             select 1 from recall_query_hits h
             join recall_uses u on u.document_id = h.document_id
             where h.query_id = q.id
               and u.occurred_at >= q.occurred_at
               and u.occurred_at <= strftime('%Y-%m-%dT%H:%M:%fZ', q.occurred_at, $2)
           ) as used
         from recall_queries q
         where q.occurred_at >= $1`,
        [since, `+${USED_WINDOW_HOURS} hours`],
      );
      const usedSignals = Number((await db.query(
        'select count(*) as n from recall_uses where occurred_at >= $1', [since],
      )).rows[0]?.n || 0);
      const items = aggregateGaps(rows.rows.map((row) => ({
        occurredAt: row.occurred_at,
        query: row.query,
        queryKey: row.query_key,
        agent: row.agent,
        source: row.source,
        hitCount: Number(row.hit_count),
        used: Boolean(row.used),
      })), { now, usedSignals, limit });
      return { items, usedSignals, since, windowHours: USED_WINDOW_HOURS };
    },

    // Agent-written active documents with no hit in the window, flagged once
    // telemetry has covered PRUNE_MIN_AGE_DAYS (before that, silence proves
    // nothing).
    async neverRecalled({ now = clock(), projectId, minAgeDays = PRUNE_MIN_AGE_DAYS } = {}) {
      const since = daysAgo(now, retentionDays);
      const oldest = (await db.query('select min(occurred_at) as oldest from recall_queries')).rows[0]?.oldest || null;
      const coverageDays = oldest ? Math.floor((new Date(now).getTime() - Date.parse(oldest)) / DAY_MS) : 0;
      if (coverageDays < minAgeDays) return { ready: false, coverageDays, minAgeDays, items: [] };
      const values = [daysAgo(now, minAgeDays), since];
      let projectClause = '';
      if (projectId) {
        values.push(projectId);
        projectClause = `and d.project_id = $${values.length}`;
      }
      const rows = await db.query(
        `select d.id, d.title, d.document_type, d.project_id, d.created_at, d.updated_at, d.updated_by_agent, d.verified
         from markdown_documents d
         where d.archived_at is null and d.status = 'active'
           and (d.updated_by = 'agent' or d.kind = 'synthesized')
           and d.created_at <= $1
           and coalesce(d.tags, '') not like '%"librarian-proposal"%'
           and not exists (
             select 1 from recall_query_hits h join recall_queries q on q.id = h.query_id
             where h.document_id = d.id and q.occurred_at >= $2
           )
           ${projectClause}
         order by d.created_at asc`,
        values,
      );
      return {
        ready: true,
        coverageDays,
        minAgeDays,
        items: rows.rows.map((row) => ({
          id: row.id,
          title: row.title,
          documentType: row.document_type,
          projectId: row.project_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          updatedByAgent: row.updated_by_agent ?? null,
          verified: Boolean(row.verified),
        })),
      };
    },
  };
}

// Schedule one query record after the response is sent. Never throws, never
// awaits: a telemetry failure is logged and dropped.
export function recordQueryLater(telemetry, entry, log) {
  if (!telemetry || !telemetry.enabled || !entry?.source) return;
  try {
    setImmediate(() => {
      try {
        Promise.resolve(telemetry.recordQuery(entry)).catch((err) => {
          try { log?.warn?.({ err }, 'recall telemetry not recorded'); } catch { /* logging is best-effort */ }
        });
      } catch (err) {
        try { log?.warn?.({ err }, 'recall telemetry not recorded'); } catch { /* logging is best-effort */ }
      }
    });
  } catch { /* scheduling is best-effort */ }
}
