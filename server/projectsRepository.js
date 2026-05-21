import { deriveSlug } from './slug.js';

const UPDATE_COLUMN_MAP = {
  name: 'name',
  status: 'status',
  sortOrder: 'sort_order',
};

export function normalizeProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      set ${assignments.join(', ')}, updated_at = now()
      where id = $1
      returning *
    `,
    values: [id, ...entries.map(([, value]) => value)],
  };
}

export function buildArchiveProject(id) {
  return {
    text: `update projects set status = 'archived', updated_at = now() where id = $1 returning *`,
    values: [id],
  };
}

export function buildCountProjectDependents(id) {
  return {
    text: `
      select (
        (select count(*) from tasks where project_id = $1)
        + (select count(*) from markdown_documents where project_id = $1)
      )::int as count
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
          if (err && err.code === '23505' && attempt < 4) continue;
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
    async countProjectDependents(id) {
      const q = buildCountProjectDependents(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? result.rows[0].count : 0;
    },
    async deleteProject(id) {
      const q = buildDeleteProject(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    async resolveProject(idOrSlug) {
      const column = isUuid(idOrSlug) ? 'id' : 'slug';
      const result = await db.query(`select * from projects where ${column} = $1 limit 1`, [idOrSlug]);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
  };
}
