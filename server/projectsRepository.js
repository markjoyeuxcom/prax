import { deriveSlug } from './slug.js';
import { toIso } from './columnTypes.js';

const UPDATE_COLUMN_MAP = {
  name: 'name',
  status: 'status',
  sortOrder: 'sort_order',
  onCall: 'on_call',
  handoffNotes: 'handoff_notes',
  repoUrl: 'repo_url',
  area: 'area',
};

export function normalizeProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    sortOrder: row.sort_order,
    onCall: row.on_call ?? null,
    handoffNotes: row.handoff_notes ?? null,
    repoUrl: row.repo_url ?? null,
    area: row.area ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function buildListProjects(status) {
  if (status && status !== 'all') {
    return {
      text: `select * from projects where status = $1 order by sort_order, name`,
      values: [status],
    };
  }
  return { text: `select * from projects order by sort_order, name`, values: [] };
}

export function buildCreateProject({ name, slug, status = 'active' }) {
  return {
    text: `
      insert into projects (name, slug, status, sort_order)
      values ($1, $2, $3, (select coalesce(max(sort_order), -1) + 1 from projects))
      returning *
    `,
    values: [name, slug, status],
  };
}

export function buildUpdateProject(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) throw new Error('No project fields provided');
  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);
  return {
    text: `
      update projects
      set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1
      returning *
    `,
    values: [id, ...entries.map(([, value]) => value)],
  };
}

export function buildArchiveProject(id) {
  return {
    text: `update projects set status = 'archived', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $1 returning *`,
    values: [id],
  };
}

// Everything filed under a project goes with it. Tasks and documents own
// their dependents through FK cascades (checklist items, activity, task↔doc
// links, document links/refs/runs; the FTS index follows its trigger), and a
// run chronicle keeps its rows with project_id set null. Staged/replayable
// import records are project-scoped bookkeeping with no meaning once the
// project is gone, so they are removed too. Order matters: children before the
// parent row, since `projects` has no cascade of its own.
export function buildDeleteProjectContents(id) {
  return [
    { text: `delete from task_import_session_chunks where session_id in (select id from task_import_sessions where project_id = $1)`, values: [id] },
    { text: `delete from task_import_sessions where project_id = $1`, values: [id] },
    { text: `delete from task_import_operations where project_id = $1`, values: [id] },
    { text: `delete from tasks where project_id = $1`, values: [id] },
    { text: `delete from markdown_documents where project_id = $1`, values: [id] },
  ];
}

export function buildCountProjectContents(id) {
  return {
    text: `
      select
        (select count(*) from tasks where project_id = $1) as tasks,
        (select count(*) from markdown_documents where project_id = $1) as documents
    `,
    values: [id],
  };
}

export function buildDeleteProject(id) {
  return {
    text: `delete from projects where id = $1 returning *`,
    values: [id],
  };
}

// pg surfaced unique violations as code 23505; node:sqlite raises
// SQLITE_CONSTRAINT_UNIQUE with a descriptive message.
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  if (err.errcode === 2067 /* SQLITE_CONSTRAINT_UNIQUE */) return true;
  return /UNIQUE constraint failed/i.test(err.message || '');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createProjectsRepository(db) {
  return {
    async listProjects(status) {
      const q = buildListProjects(status);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeProjectRow);
    },
    async createProject({ name, status }) {
      // Re-derive and retry on a slug unique-violation (23505) so a rare
      // concurrent create surfaces gracefully instead of as a 500.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await db.query('select slug from projects');
        const slug = deriveSlug(name, existing.rows.map((r) => r.slug));
        try {
          const q = buildCreateProject({ name, slug, status });
          const result = await db.query(q.text, q.values);
          return normalizeProjectRow(result.rows[0]);
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error('Could not generate a unique project slug');
    },
    async updateProject(id, fields) {
      const q = buildUpdateProject(id, fields);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    async archiveProject(id) {
      const q = buildArchiveProject(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    // Permanently delete a project with everything filed under it, as one
    // transaction: either the project and all of its contents are gone, or
    // nothing changed. Resolves `{ project, deleted: { tasks, documents } }`,
    // or null when no such project exists.
    async deleteProject(id) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const counts = buildCountProjectContents(id);
          const counted = (await client.query(counts.text, counts.values)).rows[0] || {};
          for (const statement of buildDeleteProjectContents(id)) {
            await client.query(statement.text, statement.values);
          }
          const q = buildDeleteProject(id);
          const result = await client.query(q.text, q.values);
          await client.query('commit');
          if (!result.rows[0]) return null;
          return {
            project: normalizeProjectRow(result.rows[0]),
            deleted: { tasks: Number(counted.tasks) || 0, documents: Number(counted.documents) || 0 },
          };
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },
    // Resolve a project from whatever a human or an LLM naturally provides: an
    // id, an exact slug, or the display NAME (case-insensitive, and tolerant of
    // spaces vs. hyphens — "Terrafrom Labs" resolves the "terrafrom-labs" slug).
    // Precedence: exact slug (case-insensitive) > slugified input > exact name.
    async resolveProject(idOrSlug) {
      const raw = String(idOrSlug ?? '').trim();
      if (!raw) return null;
      if (isUuid(raw)) {
        const byId = await db.query('select * from projects where id = $1 limit 1', [raw]);
        return byId.rows[0] ? normalizeProjectRow(byId.rows[0]) : null;
      }
      const slugGuess = deriveSlug(raw); // same slugifier used to mint slugs
      const result = await db.query(
        `select * from projects
           where lower(slug) = lower($1) or slug = $2 or lower(name) = lower($1)
           order by case
             when lower(slug) = lower($1) then 0
             when slug = $2 then 1
             else 2 end
           limit 1`,
        [raw, slugGuess],
      );
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
  };
}
