import { readFile } from 'node:fs/promises';

// Product-owned content, never rows in the user's library. These paths are
// fixed, never taken from request parameters. Both distribution payloads copy public/.
const STARTERS = [
  { id: 'repository-setup', label: 'Repository setup guide', title: 'Set up a repository and its Prax project', documentType: 'runbook', tags: ['repo-setup', 'agent-memory'], hint: 'New repositories, existing repositories and additional checkouts' },
  { id: 'project-overview', label: 'Project overview', title: 'Project overview', documentType: 'reference', tags: ['project-card'], hint: 'Architecture, entry points, validation and working references' },
  { id: 'repository-onboarding', label: 'Repository onboarding task', title: 'Set up repository and agent instructions', target: 'task', tags: ['repo-setup'], hint: 'A real task with notes and nine acceptance checks' },
  { id: 'agent-memory', label: 'Shared agent memory guide', title: 'Shared agent memory and repository instructions', documentType: 'runbook', tags: ['agent-memory'], hint: 'Install the tools, file knowledge and hand over work' },
];

export async function readStarterContent() {
  return Promise.all(STARTERS.map(async entry => ({
    ...entry, target: entry.target || 'document', version: 1,
    body: await readFile(new URL(`../public/starter-content/${entry.id}.md`, import.meta.url), 'utf8'),
  })));
}

export function registerStarterContentRoutes(app) {
  app.get('/api/library/starters', async () => ({ version: 1, items: await readStarterContent() }));
}
