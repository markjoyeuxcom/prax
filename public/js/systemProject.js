// Shared by the HTTP routes and UI: identity follows the stable slug, never
// a display name or installation-specific ID. Contents remain ordinary work.
const SYSTEM_PROJECTS = new Map([
  ['inbox', Object.freeze({
    name: 'Inbox', purpose: 'capture and review',
    description: 'Capture work here when its project is not yet clear, then file it in the owning project. Workspace weekly reviews are saved in the Inbox Library.',
  })],
  ['memory', Object.freeze({
    name: 'Memory', purpose: 'shared guidance',
    description: 'Keep preferences, conventions and procedures used across projects here. File project-specific work and knowledge in its owning project.',
  })],
]);

export function getSystemProject(project) {
  return SYSTEM_PROJECTS.get(project?.slug) || null;
}

export function isSystemProject(project) {
  return Boolean(getSystemProject(project));
}
