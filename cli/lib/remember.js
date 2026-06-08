// cli/lib/remember.js — the one implementation of "remember": ensure the target
// project exists, de-dup by exact title, then create or update. The CALLER resolves
// the target project slug and composes tags/kind (namespace policy stays in the thin
// callers). Shared by `moomora remember` and the moomora-remember skill wrapper.

export async function remember(client, { title, body, project, type = 'note', tags = [], kind } = {}) {
  const slug = await client.ensureProject(project);
  const documentType = type === 'runbook' ? 'runbook' : 'note';
  const allTags = Array.from(new Set(tags));

  // Dedup by EXACT title: list the project's docs and match exactly, rather than a
  // full-text title search — a title of only stop-words ("how to do it") yields an
  // empty tsquery and would otherwise create a duplicate instead of updating in place.
  const existing = (await client.listDocuments(slug)).find((d) => d.title === title);
  if (existing) {
    const doc = await client.updateMemory(existing.id, { title, body, tags: allTags });
    return { doc, action: 'updated' };
  }
  const doc = await client.createMemory({
    title, body, documentType, project: slug, tags: allTags, ...(kind ? { kind } : {}),
  });
  return { doc, action: 'created' };
}
