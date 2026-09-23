// The since-last-session memory delta (docs/superpowers/specs/2026-09-23-
// budgeted-context-and-brief-design.md):
//
//   GET /api/library/changes?since=<iso>|sinceLastSession=true[&project=][&limit=]
//   GET /api/library/recall-marker[?project=]
//   PUT /api/library/recall-marker  { project?, at }
//
// Reads only, apart from the marker, which is a monotonic setter keyed by the
// calling agent (`x-prax-agent` with `x-prax-origin: agent`) and a scope (a
// project id, or '*' for every project).
import {
  ALL_PROJECTS_SCOPE, CHANGES_DEFAULT_LIMIT, CHANGES_MAX_LIMIT, createMemoryChangesRepository,
} from './memoryChangesRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { includeHarvestedFrom } from './harvestedCandidates.js';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// The calling agent, by the same rule the write routes apply: an agent origin
// plus a short lowercase id. Anything else is no agent.
export function recallAgentFrom(request) {
  const origin = request.headers['x-prax-origin'] ?? request.headers['x-moomora-origin'];
  if (origin !== 'agent') return null;
  const raw = request.headers['x-prax-agent'];
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  return AGENT_ID_RE.test(value) ? value : null;
}

// Canonical `YYYY-MM-DDTHH:MM:SS.sssZ`, or null for anything that is not an
// ISO-8601 date or date-time.
export function canonicalInstant(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const NO_AGENT = 'an agent id is required: send x-prax-agent with x-prax-origin: agent (prax --agent <id> or PRAX_AGENT)';

export async function registerMemoryChangesRoutes(app, options = {}) {
  const repository = options.memoryChangesRepository || (app.db ? createMemoryChangesRepository(app.db) : null);
  const projectsRepository = options.projectsRepository || app.projectsRepository || (app.db ? createProjectsRepository(app.db) : null);
  const now = options.changesClock || (() => new Date());

  // `project` → { project, scope }, or { error } for an unknown one.
  async function resolveScope(raw) {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return { project: null, scope: ALL_PROJECTS_SCOPE };
    const project = await projectsRepository.resolveProject(String(raw));
    if (!project) return { error: 'project is invalid' };
    return { project, scope: project.id };
  }
  const projectRef = (project) => (project ? { id: project.id, slug: project.slug, name: project.name } : null);

  app.get('/api/library/changes', async (request, reply) => {
    if (!repository) { reply.code(503); return { message: 'memory changes are unavailable' }; }
    const query = request.query || {};
    const sinceLastSession = query.sinceLastSession === 'true' || query.sinceLastSession === true;
    const hasSince = query.since !== undefined && query.since !== '';
    if (sinceLastSession === hasSince) {
      reply.code(400); return { message: 'give exactly one of since=<iso> or sinceLastSession=true' };
    }
    let limit = CHANGES_DEFAULT_LIMIT;
    if (query.limit !== undefined) {
      const n = Number(query.limit);
      if (!Number.isInteger(n) || n < 1) { reply.code(400); return { message: 'limit must be a positive integer' }; }
      limit = Math.min(n, CHANGES_MAX_LIMIT);
    }
    const { project, scope, error } = await resolveScope(query.project);
    if (error) { reply.code(400); return { message: error }; }

    let since;
    let baseline = 'explicit';
    let agent = null;
    if (sinceLastSession) {
      agent = recallAgentFrom(request);
      if (!agent) { reply.code(400); return { message: NO_AGENT }; }
      const marker = await repository.getRecallMarker(agent, scope);
      if (!marker) {
        // No earlier delta for this agent and scope: nothing to compare
        // against. `until` is now, so recording it sets the baseline.
        return {
          agent, project: projectRef(project), baseline: 'none', since: null, until: now().toISOString(),
          items: [], page: { returned: 0, total: 0, hasMore: false, limit },
        };
      }
      since = canonicalInstant(marker.lastRecallAt);
      baseline = 'marker';
    } else {
      since = canonicalInstant(String(query.since));
      if (!since) { reply.code(400); return { message: 'since must be an ISO-8601 date or date-time' }; }
    }

    const includeHarvested = includeHarvestedFrom(query.includeHarvested);
    const page = await repository.listChanges({ since, projectId: project ? project.id : null, limit, includeHarvested });
    return {
      agent,
      project: projectRef(project),
      baseline,
      since,
      until: page.until,
      items: page.items,
      page: page.page,
      // Unreviewed harvested candidates changed in the window and left out.
      ...(page.hiddenHarvested > 0 ? { hiddenHarvested: page.hiddenHarvested } : {}),
    };
  });

  app.get('/api/library/recall-marker', async (request, reply) => {
    if (!repository) { reply.code(503); return { message: 'memory changes are unavailable' }; }
    const agent = recallAgentFrom(request);
    if (!agent) { reply.code(400); return { message: NO_AGENT }; }
    const { project, scope, error } = await resolveScope(request.query?.project);
    if (error) { reply.code(400); return { message: error }; }
    const marker = await repository.getRecallMarker(agent, scope);
    return { agent, project: projectRef(project), lastRecallAt: marker ? marker.lastRecallAt : null };
  });

  app.put('/api/library/recall-marker', async (request, reply) => {
    if (!repository) { reply.code(503); return { message: 'memory changes are unavailable' }; }
    const agent = recallAgentFrom(request);
    if (!agent) { reply.code(400); return { message: NO_AGENT }; }
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const at = canonicalInstant(body.at);
    if (!at) { reply.code(400); return { message: 'at must be an ISO-8601 date-time' }; }
    const { project, scope, error } = await resolveScope(body.project);
    if (error) { reply.code(400); return { message: error }; }
    // Never later than the server's clock: a marker in the future would hide
    // every change until then.
    const clock = now().toISOString();
    const marker = await repository.advanceRecallMarker(agent, scope, at > clock ? clock : at);
    return { agent, project: projectRef(project), lastRecallAt: marker.lastRecallAt };
  });
}
