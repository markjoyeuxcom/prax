// Memory changes and per-agent recall markers — the data layer behind the
// since-last-session delta (docs/design/budgeted-context-and-brief.md). Pure build* query builders returning { text, values },
// a boundary normaliser, and a createMemoryChangesRepository(db) factory.
//
// A change is any of four stamps later than `since`: created_at, updated_at
// (content edits, and the supersession triggers of 0012/0018), verified_at
// (while still verified) and archived_at. Unverification clears verified_at
// and so is not visible here; that limit is documented, not papered over.
import { normalizeTitle } from './documentTitle.js';
import { unreviewedHarvestedSql } from './harvestedCandidates.js';

export const CHANGES_DEFAULT_LIMIT = 50;
export const CHANGES_MAX_LIMIT = 200;
const SNIPPET_CHARS = 800;
// The '*' scope is the all-projects feed; any other scope is a project id.
export const ALL_PROJECTS_SCOPE = '*';

// Canonical form of a stored or supplied timestamp, so text comparison is
// chronological whatever spelling a row was written with.
const NORM = (column) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;

// The changed documents' columns plus their normalised stamps and the latest
// of them (`changed_at`). `$1` = since (canonical ISO), `$2` = project id or null.
// `harvested` selects unreviewed harvested candidates: 'exclude' leaves them
// out (the default feed), 'only' keeps only them (to count what was hidden),
// 'include' applies no filter.
const HARVESTED_FILTER = {
  include: '',
  exclude: ` and not ${unreviewedHarvestedSql('d')}`,
  only: ` and ${unreviewedHarvestedSql('d')}`,
};
const changedRows = (harvested = 'include') => `
  select * from (
    select d.id, d.title, d.body, d.document_type, d.project_id, p.slug as project_slug, d.tags,
      d.kind, d.verified, d.verified_at, d.verified_by, d.status, d.updated_by, d.updated_by_agent,
      d.created_at, d.updated_at, d.archived_at,
      ${NORM('d.created_at')} as c_at,
      ${NORM('d.updated_at')} as u_at,
      case when d.verified = 1 then ${NORM('d.verified_at')} end as v_at,
      ${NORM('d.archived_at')} as a_at,
      max(
        coalesce(${NORM('d.created_at')}, ''),
        coalesce(${NORM('d.updated_at')}, ''),
        coalesce(case when d.verified = 1 then ${NORM('d.verified_at')} end, ''),
        coalesce(${NORM('d.archived_at')}, '')
      ) as changed_at,
      (
        select json_group_array(link.source_document_id)
        from document_links link
        where link.target_document_id = d.id and link.relation = 'supersedes'
      ) as superseded_by
    from markdown_documents d
    join projects p on p.id = d.project_id
    where ($2 is null or d.project_id = $2)${HARVESTED_FILTER[harvested] ?? ''}
  ) changed
  where changed.changed_at > $1
    and (changed.archived_at is null or changed.a_at > $1)
`;

export function buildListChanges({ since, projectId = null, limit, harvested = 'include' }) {
  return {
    text: `${changedRows(harvested)} order by changed.changed_at, changed.id limit $3`,
    values: [since, projectId, limit],
  };
}

// The rest of a tie at a page boundary: rows sharing the boundary's changed_at
// that sort after the last row returned. A page never splits a tie, because the
// next page starts strictly after `until`.
export function buildListTieRemainder({ since, projectId = null, changedAt, afterId, harvested = 'include' }) {
  return {
    text: `${changedRows(harvested)} and changed.changed_at = $3 and changed.id > $4 order by changed.id`,
    values: [since, projectId, changedAt, afterId],
  };
}

export function buildCountChanges({ since, projectId = null, harvested = 'include' }) {
  return {
    text: `select count(*) as total from (${changedRows(harvested)})`,
    values: [since, projectId],
  };
}

export function buildGetRecallMarker(agent, scope) {
  return {
    text: 'select agent, scope, last_recall_at, updated_at from agent_recall_markers where agent = $1 and scope = $2',
    values: [agent, scope],
  };
}

// Monotonic: a marker only moves forward, so a retry, a stale session or two
// sessions of the same agent can never move it back and replay old changes.
export function buildAdvanceRecallMarker(agent, scope, at) {
  return {
    text: `
      insert into agent_recall_markers (agent, scope, last_recall_at, updated_at)
      values ($1, $2, $3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      on conflict (agent, scope) do update set
        last_recall_at = max(agent_recall_markers.last_recall_at, excluded.last_recall_at),
        updated_at = excluded.updated_at
      returning agent, scope, last_recall_at, updated_at
    `,
    values: [agent, scope, at],
  };
}

function parseIdList(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string').sort() : [];
  } catch {
    return [];
  }
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Which changes a row carries in the window. Created in the window is
// `created` only; a retired row reports its lifecycle state rather than a
// bare `updated` (the supersession triggers bump updated_at).
export function classifyChange(row, since) {
  const changes = [];
  const created = row.c_at && row.c_at > since;
  if (created) changes.push('created');
  const status = row.status || 'active';
  const archived = Boolean(row.a_at && row.a_at > since);
  const touched = Boolean(row.u_at && row.u_at > since);
  // A retired row reports its lifecycle state; archiving can bump updated_at
  // too, so an archived row is not also called `updated`.
  if (status !== 'active' && (created || touched)) changes.push(status);
  else if (!created && touched && !archived) changes.push('updated');
  if (row.v_at && row.v_at > since) changes.push('verified');
  if (archived) changes.push('archived');
  return changes;
}

export function normalizeChangeRow(row, since) {
  const body = String(row.body || '');
  return {
    id: row.id,
    title: normalizeTitle(row.title),
    documentType: row.document_type,
    projectId: row.project_id,
    projectSlug: row.project_slug ?? null,
    tags: parseTags(row.tags),
    kind: row.kind || 'source',
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at ?? null,
    verifiedBy: row.verified_by ?? null,
    status: row.status || 'active',
    updatedBy: row.updated_by ?? null,
    updatedByAgent: row.updated_by_agent ?? null,
    createdAt: row.c_at ?? null,
    updatedAt: row.u_at ?? null,
    archivedAt: row.a_at ?? null,
    supersededBy: parseIdList(row.superseded_by),
    changes: classifyChange(row, since),
    changedAt: row.changed_at,
    snippet: body.length > SNIPPET_CHARS ? `${body.slice(0, SNIPPET_CHARS)}…` : body,
  };
}

function normalizeMarker(row) {
  if (!row) return null;
  return {
    agent: row.agent,
    scope: row.scope,
    lastRecallAt: row.last_recall_at,
    updatedAt: row.updated_at,
  };
}

export function createMemoryChangesRepository(db) {
  return {
    // One page of changes after `since` (canonical ISO), oldest first, never
    // splitting a tie at the boundary. `until` is the last row's changed_at
    // (or `since` when nothing changed) — never the clock, so a write that
    // commits while this page is read is picked up by the next one.
    //
    // Unreviewed harvested candidates are left out unless `includeHarvested`;
    // `hiddenHarvested` counts those changed in the window, so the delta can
    // say so. A candidate a person later verifies (or refiles without the tag)
    // is reported then, as `verified` or `updated`.
    async listChanges({ since, projectId = null, limit = CHANGES_DEFAULT_LIMIT, includeHarvested = false }) {
      const bound = Math.min(Math.max(1, Math.trunc(Number(limit) || CHANGES_DEFAULT_LIMIT)), CHANGES_MAX_LIMIT);
      const harvested = includeHarvested ? 'include' : 'exclude';
      const page = buildListChanges({ since, projectId, limit: bound + 1, harvested });
      const first = await db.query(page.text, page.values);
      let rows = first.rows.slice(0, bound);
      if (first.rows.length > bound) {
        const last = rows[rows.length - 1];
        if (first.rows[bound].changed_at === last.changed_at) {
          const rest = buildListTieRemainder({ since, projectId, changedAt: last.changed_at, afterId: last.id, harvested });
          const tie = await db.query(rest.text, rest.values);
          rows = rows.concat(tie.rows);
        }
      }
      const count = buildCountChanges({ since, projectId, harvested });
      const total = Number((await db.query(count.text, count.values)).rows[0]?.total ?? 0);
      let hiddenHarvested = 0;
      if (!includeHarvested) {
        const hidden = buildCountChanges({ since, projectId, harvested: 'only' });
        hiddenHarvested = Number((await db.query(hidden.text, hidden.values)).rows[0]?.total ?? 0);
      }
      const items = rows.map((row) => normalizeChangeRow(row, since));
      return {
        items,
        until: items.length ? items[items.length - 1].changedAt : since,
        page: { returned: items.length, total, hasMore: total > items.length, limit: bound },
        hiddenHarvested,
      };
    },

    async getRecallMarker(agent, scope) {
      const q = buildGetRecallMarker(agent, scope);
      return normalizeMarker((await db.query(q.text, q.values)).rows[0]);
    },

    async advanceRecallMarker(agent, scope, at) {
      const q = buildAdvanceRecallMarker(agent, scope, at);
      return normalizeMarker((await db.query(q.text, q.values)).rows[0]);
    },
  };
}
