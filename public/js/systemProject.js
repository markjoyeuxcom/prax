// The one reserved system project: the shared agent-memory home (slug
// 'memory', see server/migrations/0030 and server/projectsRoutes.js). The
// server refuses to rename, change the status of, or delete it; the UI simply
// does not offer those actions on it. Every other project — Inbox included —
// is an ordinary project the person may delete.
export const SYSTEM_PROJECT_SLUG = 'memory';

export function isSystemProject(project) {
  return Boolean(project) && project.slug === SYSTEM_PROJECT_SLUG;
}
