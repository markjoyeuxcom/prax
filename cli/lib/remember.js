// cli/lib/remember.js — the one implementation of "remember": ensure the target
// project exists, then create-or-update by exact title. The CALLER resolves the
// target project slug and composes tags/kind (namespace policy stays in the thin
// callers). Shared by `prax remember` and the prax-remember skill.
//
// The write is one server-side transaction (POST …/upsert-by-title): two agents
// remembering the same title at once can no longer both create it, and a
// superseded/deprecated title is never revived — a fresh memory under a retired
// title becomes a new active document. Servers that predate the endpoint (404)
// get the older read-then-write path, with the same active-only rule.
//
// Upsert-by-title is PROJECT-scoped, and recall is not: an agent recalls a
// homelab runbook, refines it, runs remember without --project, and the write
// lands in `memory` as a second copy — split-brain, both looking current. So
// when the caller did not choose a project (`crossProject`), the library is
// checked for the exact title first: a same-title document that lives only in
// another project is updated THERE. `id` targets one document outright.
import { randomUUID } from 'node:crypto';

export class AmbiguousTitleError extends Error {
  constructor(title, matches) {
    const where = matches.map((m) => `${m.projectSlug || m.projectId || '?'}:${m.id}`).join(', ');
    super(`"${title}" exists in more than one project (${where}) — pass --project <slug> or --id <uuid> to say which one to update`);
    this.name = 'AmbiguousTitleError';
    this.matches = matches;
  }
}

function isActive(doc) {
  return (doc?.status ?? 'active') === 'active';
}

// Merge rather than replace: the document being refined belongs to another
// project and may carry tags the caller never saw. Order keeps the stored tags
// first so nothing the human typed moves.
function mergedTags(existing, incoming = []) {
  return Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...incoming]));
}

// `type` is the EXPLICIT type the user asked for (undefined = not specified).
// On create it defaults to 'note'; on update-in-place it retypes ONLY when
// explicit — a plain re-remember to refresh a body must never demote a
// decision/runbook back to note. Callers validate the value before passing it.
//
// `tags` undefined = the caller gave none: an update keeps the stored tags on
// every path (a create starts with none). An array replaces them on a
// same-title update and is merged into them on --id / cross-project.
//
// Returns { doc, action, project } — `project` is the slug the write landed in,
// which under crossProject may differ from the one passed. `crossProject: true`
// on the result says the document was updated where it already lived.
export async function remember(client, { title, body, project, type, tags, kind, id, crossProject = false } = {}) {
  const allTags = Array.isArray(tags) ? Array.from(new Set(tags)) : undefined;
  const tagsPatch = allTags ? { tags: allTags } : {};
  const typePatch = type ? { documentType: type } : {};

  // A direct target: no title lookup, no project resolution. The title is part
  // of the patch on purpose — pointing at an id is also how a memory is renamed.
  if (id) {
    const existing = await client.getDocument(id);
    const doc = await client.updateMemory(id, { title, body, tags: mergedTags(existing?.tags, allTags), ...typePatch,
      ...(existing?.revision ? { ifRevision: existing.revision } : {}) });
    return { doc, action: 'updated', project: existing?.projectSlug ?? doc?.projectSlug ?? project ?? null, byId: true };
  }

  const slug = await client.ensureProject(project);

  if (crossProject) {
    const elsewhere = await findTitleElsewhere(client, title, slug);
    if (elsewhere) {
      const doc = await client.updateMemory(elsewhere.id, { body, tags: mergedTags(elsewhere.tags, allTags), ...typePatch,
        ...(elsewhere.revision ? { ifRevision: elsewhere.revision } : {}) });
      return { doc, action: 'updated', project: elsewhere.projectSlug, crossProject: true };
    }
  }

  // A caller-stable id makes one lost transport response safe to retry.
  const newId = randomUUID();

  if (typeof client.upsertMemory === 'function') {
    try {
      const result = await client.upsertMemory({
        id: newId, title, body, project: slug,
        ...tagsPatch,
        ...typePatch,
        ...(kind ? { kind } : {}),
      });
      return { doc: result.document, action: result.created ? 'created' : 'updated', project: slug };
    } catch (err) {
      if (err?.status !== 404) throw err; // 404 = the route does not exist on this server
    }
  }
  return legacyRemember(client, { id: newId, title, body, slug, type, tags: allTags, kind });
}

// The active document with this exact title that lives in ANOTHER project, or
// null when the target project has its own (the ordinary upsert handles that),
// when nothing matches. Older listings may expose only projectId; resolve
// those through the project list rather than creating a second copy. More than one candidate is an
// error: picking silently would be the same split-brain in a new place.
async function findTitleElsewhere(client, title, slug) {
  const docs = await client.listDocuments(undefined, { status: 'active' });
  let matches = (Array.isArray(docs) ? docs : []).filter((d) => d && d.title === title && isActive(d));
  if (!matches.length) return null;
  if (matches.some((d) => !d.projectSlug)) {
    const projects = await client.listProjects();
    const byId = new Map(projects.map(p => [p.id, p.slug]));
    matches = matches.map(d => ({ ...d, projectSlug: d.projectSlug || byId.get(d.projectId) }));
    if (matches.some(d => !d.projectSlug)) throw new Error('Cannot resolve the project of an existing same-title memory; pass --id to target it explicitly.');
  }
  if (matches.some((d) => d.projectSlug === slug)) return null;
  if (matches.length > 1) throw new AmbiguousTitleError(title, matches);
  return matches[0];
}

// Read-then-write for servers without upsert-by-title. Only ACTIVE documents
// count as a duplicate. Dedup by EXACT title over the listing rather than a
// full-text title search — a title of only stop-words ("how to do it") yields
// an empty tsquery and would otherwise create a duplicate instead of updating.
async function legacyRemember(client, { id, title, body, slug, type, tags, kind }) {
  const docs = await client.listDocuments(slug, { status: 'active' });
  const existing = (Array.isArray(docs) ? docs : [])
    .find((d) => d.title === title && isActive(d));
  if (existing) {
    const doc = await client.updateMemory(existing.id, {
      title, body,
      ...(tags ? { tags } : {}),
      ...(existing.revision ? { ifRevision: existing.revision } : {}),
      ...(type ? { documentType: type } : {}), // retype only on an explicit --type
    });
    return { doc, action: 'updated', project: slug };
  }
  const doc = await client.createMemory({
    id, title, body, documentType: type || 'note', project: slug, tags: tags || [],
    ...(kind ? { kind } : {}),
  });
  return { doc, action: 'created', project: slug };
}
