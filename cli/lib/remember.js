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
import { randomUUID } from 'node:crypto';

// `type` is the EXPLICIT type the user asked for (undefined = not specified).
// On create it defaults to 'note'; on update-in-place it retypes ONLY when
// explicit — a plain re-remember to refresh a body must never demote a
// decision/runbook back to note. Callers validate the value before passing it.
export async function remember(client, { title, body, project, type, tags = [], kind } = {}) {
  const slug = await client.ensureProject(project);
  const allTags = Array.from(new Set(tags));
  // A caller-stable id makes one lost transport response safe to retry.
  const id = randomUUID();

  if (typeof client.upsertMemory === 'function') {
    try {
      const result = await client.upsertMemory({
        id, title, body, project: slug, tags: allTags,
        ...(type ? { documentType: type } : {}),
        ...(kind ? { kind } : {}),
      });
      return { doc: result.document, action: result.created ? 'created' : 'updated' };
    } catch (err) {
      if (err?.status !== 404) throw err; // 404 = the route does not exist on this server
    }
  }
  return legacyRemember(client, { id, title, body, slug, type, tags: allTags, kind });
}

// Read-then-write for servers without upsert-by-title. Only ACTIVE documents
// count as a duplicate. Dedup by EXACT title over the listing rather than a
// full-text title search — a title of only stop-words ("how to do it") yields
// an empty tsquery and would otherwise create a duplicate instead of updating.
async function legacyRemember(client, { id, title, body, slug, type, tags, kind }) {
  const docs = await client.listDocuments(slug, { status: 'active' });
  const existing = (Array.isArray(docs) ? docs : [])
    .find((d) => d.title === title && (d.status ?? 'active') === 'active');
  if (existing) {
    const doc = await client.updateMemory(existing.id, {
      title, body, tags,
      ...(type ? { documentType: type } : {}), // retype only on an explicit --type
    });
    return { doc, action: 'updated' };
  }
  const doc = await client.createMemory({
    id, title, body, documentType: type || 'note', project: slug, tags,
    ...(kind ? { kind } : {}),
  });
  return { doc, action: 'created' };
}
