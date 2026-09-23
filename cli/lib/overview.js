// cli/lib/overview.js — `prax overview`: the project's orientation card in one
// call, whatever its trust. `prax context` leads with the card only once it is
// verified; an agent starting work still needs the unverified one, labelled as
// such, instead of a search-then-get dance.
//
// Choice order, active documents only: a verified document tagged
// `project-card`, then any document tagged `project-card` (newest first), then
// one titled exactly "<Project name> project overview". Read-only.

const CARD_TAG = 'project-card';

function newestFirst(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

// docs: the project's active documents (listing shape). Returns
// { doc, source: 'project-card' | 'title' } or null.
export function pickProjectCard(docs, projectName) {
  const active = (Array.isArray(docs) ? docs : []).filter((d) => d && (d.status ?? 'active') === 'active' && !d.archivedAt);
  const cards = active.filter((d) => Array.isArray(d.tags) && d.tags.includes(CARD_TAG)).sort(newestFirst);
  const card = cards.find((d) => d.verified) || cards[0];
  if (card) return { doc: card, source: 'project-card' };
  const wanted = `${String(projectName || '').trim()} project overview`.toLowerCase();
  const titled = active.filter((d) => String(d.title || '').trim().toLowerCase() === wanted).sort(newestFirst)[0];
  return titled ? { doc: titled, source: 'title' } : null;
}

// The one-line caveat printed above the card.
export function overviewCaveat({ doc, source }) {
  const how = source === 'project-card' ? 'tagged project-card' : 'matched by title (not tagged project-card)';
  if (doc.verified) return `Project overview — verified${doc.verifiedBy ? ` by ${doc.verifiedBy}` : ''}, ${how}.`;
  return `Project overview — UNVERIFIED (agent-written or not yet reviewed), ${how}. Treat it as a lead and check it against the code.`;
}

// Resolves the project's card and fetches its full body. Returns
// { project, found: false } or { project, found: true, source, doc }.
export async function projectOverview(client, slug) {
  const projects = await client.listProjects();
  const project = (Array.isArray(projects) ? projects : []).find((p) => p.slug === slug) || { slug, name: slug };
  const docs = await client.listDocuments(slug, { status: 'active' });
  const picked = pickProjectCard(docs, project.name);
  if (!picked) return { project, found: false };
  const doc = await client.getDocument(picked.doc.id);
  return { project, found: true, source: picked.source, doc: { ...picked.doc, ...doc } };
}
