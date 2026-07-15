// cli/lib/remember.js — the one implementation of "remember": ensure the target
// project exists, de-dup by exact title, then create or update. The CALLER resolves
// the target project slug and composes tags/kind (namespace policy stays in the thin
// callers). Shared by `prax remember` and the prax-remember skill wrapper.
import { randomUUID } from 'node:crypto';

// `type` is the EXPLICIT type the user asked for (undefined = not specified).
// On create it defaults to 'note'; on update-in-place it retypes ONLY when
// explicit — a plain re-remember to refresh a body must never demote a
// decision/runbook back to note. Callers validate the value before passing it.
export async function remember(client, { title, body, project, type, tags = [], kind } = {}) {
  const slug = await client.ensureProject(project);
  const allTags = Array.from(new Set(tags));

  // Dedup by EXACT title: list the project's docs and match exactly, rather than a
  // full-text title search — a title of only stop-words ("how to do it") yields an
  // empty tsquery and would otherwise create a duplicate instead of updating in place.
  const existing = (await client.listDocuments(slug)).find((d) => d.title === title);
  if (existing) {
    const doc = await client.updateMemory(existing.id, {
      title, body, tags: allTags,
      ...(type ? { documentType: type } : {}), // retype only on an explicit --type
    });
    return { doc, action: 'updated' };
  }
  const doc = await client.createMemory({
    id: randomUUID(), title, body, documentType: type || 'note', project: slug, tags: allTags,
    ...(kind ? { kind } : {}),
  });
  return { doc, action: 'created' };
}
