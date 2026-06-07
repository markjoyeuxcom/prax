// API-seeding helpers for e2e specs. Each function takes a Playwright
// APIRequestContext (page.request) so calls share the configured baseURL.
// NOTE: there is no teardown — the demo server's in-memory state persists for
// the whole `npm run test:e2e` run. Specs use unique per-test title prefixes and
// must assert only against their own seeded rows (never against total counts).

export async function resolveProjectId(request, slug) {
  const res = await request.get('/api/projects');
  if (!res.ok()) throw new Error(`GET /api/projects failed: ${res.status()} ${await res.text()}`);
  const projects = await res.json();
  const project = projects.find((p) => p.slug === slug);
  if (!project) throw new Error(`No project with slug "${slug}"`);
  return project.id;
}

export async function createDocument(request, doc, { origin } = {}) {
  const res = await request.post('/api/library/documents', {
    data: doc,
    ...(origin ? { headers: { 'x-moomora-origin': origin } } : {}),
  });
  if (!res.ok()) throw new Error(`POST document failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function linkDocuments(request, sourceId, targetId, relation) {
  const res = await request.post(`/api/library/documents/${sourceId}/links`, {
    data: { targetId, relation },
  });
  if (!res.ok()) throw new Error(`POST link failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function updateDocument(request, id, patch) {
  const res = await request.patch(`/api/library/documents/${id}`, { data: patch });
  if (!res.ok()) throw new Error(`PATCH document failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

// Higher-level fixture builders. `prefix` makes titles unique across specs
// sharing the one demo-server instance, so rows are located unambiguously.

export async function seedDerivedFromPair(request, prefix) {
  const projectId = await resolveProjectId(request, 'homelab');
  const source = await createDocument(request, {
    title: `${prefix} source`,
    body: '# source\n\noriginal body\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  });
  const synthesized = await createDocument(request, {
    title: `${prefix} synthesized`,
    body: '# synthesized\n\nderived body\n',
    documentType: 'note',
    project: projectId,
    kind: 'synthesized',
    tags: ['e2e'],
  });
  await linkDocuments(request, synthesized.id, source.id, 'derived-from');
  return { projectId, source, synthesized };
}

export async function seedStalePair(request, prefix) {
  const seeded = await seedDerivedFromPair(request, prefix);
  // Editing the source body changes its content hash, so the snapshot on the
  // derived-from link no longer matches -> the synthesized doc is now stale.
  await updateDocument(request, seeded.source.id, {
    body: '# source\n\nedited body — invalidates the snapshot\n',
  });
  return seeded;
}

export async function seedOrphan(request, prefix) {
  const projectId = await resolveProjectId(request, 'work');
  const orphan = await createDocument(request, {
    title: `${prefix} orphan`,
    body: '# orphan\n',
    documentType: 'note',
    project: projectId,
    tags: ['e2e'],
  });
  return { projectId, orphan };
}

export async function seedTrustPair(request, prefix) {
  const projectId = await resolveProjectId(request, 'homelab');
  // Seed as agent-written so the docs start unverified (agents write unverified; humans verify).
  const primary = await createDocument(request, {
    title: `${prefix} primary`,
    body: '# primary\n\noriginal\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  }, { origin: 'agent' });
  const replacement = await createDocument(request, {
    title: `${prefix} replacement`,
    body: '# replacement\n\nnewer\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  }, { origin: 'agent' });
  return { projectId, primary, replacement };
}
