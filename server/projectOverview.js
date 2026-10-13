// server/projectOverview.js — every project gets one overview document, its
// master page: "<Name> project overview", tagged `project-card`, created from
// the bundled starter (public/starter-content/project-overview.md) with the
// facts Prax already knows filled in. `prax overview` and the context pack
// read the card; a person fills the placeholders and verifies it.
//
// The seed is a copy, never a database seed of the product file: the master
// stays product-owned (server/starterContent.js). The copy lands UNVERIFIED
// whoever created the project — a template is not knowledge anyone vouched for.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getSystemProject } from '../public/js/systemProject.js';

export const OVERVIEW_TAG = 'project-card';
const STARTER_URL = new URL('../public/starter-content/project-overview.md', import.meta.url);

export function overviewTitle(name) {
  return `${String(name || '').trim()} project overview`;
}

// The seeded card's id is a function of the project, so two concurrent
// requests (the create route and `prax init`, two Overview clicks) resolve to
// ONE document through the idempotent create instead of racing to two.
export function overviewDocumentId(projectId) {
  const hex = createHash('sha256').update(`project-overview:${projectId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function hasTag(doc, tag) {
  return Array.isArray(doc?.tags) && doc.tags.includes(tag);
}

function newestFirst(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function isCard(doc, name) {
  return hasTag(doc, OVERVIEW_TAG)
    || String(doc?.title || '').trim().toLowerCase() === overviewTitle(name).toLowerCase();
}

// The project's current card among its active documents: a verified
// `project-card` first, then the newest, then the exact title. This is the
// one choice rule; cli/lib/overview.js (`prax overview`) wraps it. null when
// the project has none.
export function pickOverview(docs, name) {
  const active = (Array.isArray(docs) ? docs : [])
    .filter((d) => d && (d.status ?? 'active') === 'active' && !d.archivedAt);
  const cards = active.filter((d) => hasTag(d, OVERVIEW_TAG)).sort(newestFirst);
  const card = cards.find((d) => d.verified) || cards[0];
  if (card) return card;
  const wanted = overviewTitle(name).toLowerCase();
  return active.filter((d) => String(d.title || '').trim().toLowerCase() === wanted).sort(newestFirst)[0] || null;
}

// The starter with the facts Prax knows filled in; every other placeholder
// stays for the person (or agent) who knows the project to replace. Replacer
// functions: a `$` in a name or URL is literal text, never a replacement
// pattern.
export function fillOverviewTemplate(template, { name, slug, repoUrl } = {}) {
  const title = String(name || '').trim();
  let body = String(template || '');
  body = body.replace(/<Project name>/g, () => title);
  body = body.replace('<name and slug>', () => (slug ? `${title} (${slug})` : title));
  if (repoUrl) body = body.replace('<repository URL>', () => repoUrl);
  return body;
}

export async function readOverviewTemplate() {
  return readFile(STARTER_URL, 'utf8');
}

// A card the person archived is a decision, not an absence: the seed must not
// quietly put a fresh starter beside it. (A repository without archive
// listing — the demo — reports none.)
async function archivedOverview(libraryRepository, project) {
  try {
    const docs = await libraryRepository.listDocuments({ projectId: project.id, archived: true });
    return (Array.isArray(docs) ? docs : []).filter((d) => isCard(d, project.name)).sort(newestFirst)[0] || null;
  } catch {
    return null;
  }
}

// Finds or creates the project's overview. Returns { document, created }, or
// { document, created: false, archived: true } when the only card is in the
// archive (restore it, or delete it, before a new one is seeded).
// A system project (Inbox, Memory) has a fixed purpose and gets no card.
// `actor` is the request origin: an agent create is attributed to the agent;
// a person's create is still filed unverified (`verified: false`).
export async function ensureProjectOverview({ libraryRepository, project, actor = {}, template = null }) {
  if (!libraryRepository || !project?.id) return { document: null, created: false };
  if (getSystemProject(project)) return { document: null, created: false, reserved: true };
  const docs = await libraryRepository.listDocuments({ projectId: project.id, status: 'active' });
  const existing = pickOverview(docs, project.name);
  if (existing) return { document: existing, created: false };
  const archived = await archivedOverview(libraryRepository, project);
  if (archived) return { document: archived, created: false, archived: true };
  const body = fillOverviewTemplate(template ?? await readOverviewTemplate(), project);
  const agent = actor.updatedBy === 'agent';
  const fields = {
    title: overviewTitle(project.name),
    body,
    documentType: 'reference',
    projectId: project.id,
    tags: [OVERVIEW_TAG],
    updatedBy: agent ? 'agent' : 'user',
    ...(agent && actor.updatedByAgent ? { updatedByAgent: actor.updatedByAgent } : {}),
    verified: false,
  };
  if (typeof libraryRepository.createDocumentIdempotent === 'function') {
    const result = await libraryRepository.createDocumentIdempotent({ id: overviewDocumentId(project.id), ...fields });
    const doc = result.document;
    if (result.created) return { document: doc, created: true };
    // Not created: a concurrent request won (the same active card, returned),
    // or the derived id belongs to a card that is no longer this project's
    // active one (moved to another project, superseded). Only the former is
    // this project's overview; the latter gets a fresh card under a new id.
    if (doc && doc.projectId === project.id && !doc.archivedAt && (doc.status ?? 'active') === 'active') {
      return { document: doc, created: false };
    }
  }
  const document = await libraryRepository.createDocument(fields);
  return { document, created: true };
}

// Active, non-system projects with no overview: the doctor check. Each entry
// is { id, slug, name }. One listing of the active library, grouped by
// project, whatever the number of projects.
export async function projectsWithoutOverview({ libraryRepository, projects }) {
  const candidates = (Array.isArray(projects) ? projects : [])
    .filter((p) => p && p.status === 'active' && !getSystemProject(p));
  if (candidates.length === 0) return [];
  const docs = candidates.length === 1
    ? await libraryRepository.listDocuments({ projectId: candidates[0].id, status: 'active' })
    : await libraryRepository.listDocuments({ status: 'active' });
  const byProject = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!byProject.has(doc.projectId)) byProject.set(doc.projectId, []);
    byProject.get(doc.projectId).push(doc);
  }
  return candidates
    .filter((p) => !pickOverview(byProject.get(p.id) || [], p.name))
    .map((p) => ({ id: p.id, slug: p.slug, name: p.name }));
}
