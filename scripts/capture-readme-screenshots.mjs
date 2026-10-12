// Regenerate the README screenshots (docs/images/prax-*.png) from a seeded
// demo server, so they match the shipped shell instead of drifting behind it.
// Uses the existing Playwright development dependency, like build-tray-icon.mjs.
//
//   node scripts/capture-readme-screenshots.mjs
//
// Starts scripts/demo-server.js on a spare port, seeds a plausible workspace
// through the public API (projects with areas and on-call notes, a year's
// worth of overdue / due / planned / done tasks, human and agent-written
// documents), then captures each view at 1280×800.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PORT = process.env.PRAX_SHOTS_PORT || '3177';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url));
const VIEWPORT = { width: 1280, height: 800 };

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('demo server did not start');
}

async function seed() {
  const projects = Object.fromEntries((await api('/api/projects')).map((project) => [project.name, project]));
  const homelab = projects.Homelab.id;
  const work = projects.Work.id;
  const personal = projects.Personal.id;
  await api(`/api/projects/${homelab}`, { method: 'PATCH', body: { onCall: 'Mark', handoffNotes: 'Talos upgrade window Wed 20:00. CNPG backup still failing on B2 auth — see the known issue.' } });

  const today = daysFromNow(0);
  const task = (title, project, patch = {}) => api('/api/tasks', { method: 'POST', body: { title, project, status: 'planned', priority: 'medium', ...patch } });
  // Overdue, oldest first.
  await task('Replace UPS batteries', homelab, { priority: 'low', dueDate: daysFromNow(-20) });
  await task('Back up CNPG cluster to B2', homelab, { priority: 'high', dueDate: daysFromNow(-7), labels: ['infra'] });
  await task('Rotate Cloudflare tunnel token', homelab, { dueDate: daysFromNow(-4), labels: ['security'] });
  await task('Write on-call onboarding doc', work, { dueDate: daysFromNow(-3) });
  // Due today (one planned).
  const patch = await task('Patch ingress-nginx to 1.13', homelab, { priority: 'high', dueDate: today, dueTime: '16:00', labels: ['k8s'] });
  await task('Verify Restic snapshot prune ran', homelab, { dueDate: today, labels: ['backup'] });
  await api(`/api/tasks/${patch.id}`, { method: 'PATCH', body: { plannedFor: today } });
  const roadmap = await task('Review Q4 platform roadmap', work, { dueDate: daysFromNow(2) });
  await api(`/api/tasks/${roadmap.id}`, { method: 'PATCH', body: { plannedFor: today } });
  // The week ahead.
  await task('Move Grafana dashboards to Git provisioning', homelab, { dueDate: daysFromNow(2), labels: ['observability'] });
  await task('Upgrade Talos nodes to 1.11', homelab, { priority: 'high', dueDate: daysFromNow(3), dueTime: '20:00', labels: ['k8s'] });
  await task('Label PVCs for Velero', homelab, { priority: 'low', dueDate: daysFromNow(4), labels: ['backup'] });
  await task('Test failover for Postgres primary', homelab, { dueDate: daysFromNow(5), labels: ['postgres'] });
  await task('Renew domain', personal, { priority: 'low', dueDate: daysFromNow(2) });
  // Later, undated, in progress, done.
  await task('Retire the old NAS', homelab, { priority: 'low', dueDate: daysFromNow(30) });
  await task('Document tunnel DNS records', homelab, { priority: 'low' });
  await task('Migrate DNS to the new tunnel', homelab, { status: 'in-progress', priority: 'high', labels: ['dns'] });
  await task('Tune CNPG backup retention', homelab, { status: 'in-progress', labels: ['postgres'] });
  await task('Reply to vendor RFP', work, { status: 'completed' });
  await task('Swap the failed SSD', homelab, { status: 'completed' });

  const doc = (title, body, project, documentType, tags, headers) => api('/api/library/documents', {
    method: 'POST', headers, body: { title, body: `# ${title}\n\n${body}`, project, documentType, tags },
  });
  await doc('Postgres failover test, Sep 11', 'Promoted the replica in 41 s; the app reconnected on its own. Keep the runbook.', homelab, 'post-mortem', ['postgres'], {});
  await doc('Keep the Cloudflare tunnel over Tailscale Funnel', 'The tunnel keeps the WAF in front of everything; Funnel would bypass it.', homelab, 'decision', ['cloudflare', 'dns'], {});
  const agent = (id) => ({ 'x-prax-origin': 'agent', 'x-prax-agent': id });
  await doc('CNPG restore fails when the B2 app key lacks listBuckets', 'The restore aborts at bucket listing. Grant listBuckets on the application key.', homelab, 'known-issue', ['postgres', 'backup'], agent('claude'));
  await doc('Talos 1.11 upgrade: drain order for control-plane nodes', '1. Drain workers first. 2. Upgrade control planes one at a time. 3. Verify etcd quorum between each.', homelab, 'runbook', ['talos', 'k8s'], agent('codex'));
  await doc('Grafana dashboards live in git, provisioned by the sidecar', 'Dashboards are JSON under infra/grafana; the sidecar loads them at start.', homelab, 'note', ['grafana'], agent('copilot'));
  await doc('Velero backup schedule and the PVC label convention', 'Nightly at 02:00; PVCs need backup=true to be included.', homelab, 'reference', ['backup', 'k8s'], agent('claude'));
  return { homelab };
}

async function capture() {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./demo-server.js', import.meta.url))], {
    env: { ...process.env, PORT, HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const { homelab } = await seed();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' });
    const page = await context.newPage();
    // Land on Homelab, table layout off, nothing folded: the README's baseline.
    await page.addInitScript((projectId) => {
      localStorage.setItem('moomora.activeProject.v1', projectId);
      localStorage.setItem('prax.recentProjects.v1', JSON.stringify([projectId]));
      // No due-date reminder toast over the bottom of every shot.
      localStorage.setItem('prax.preferences', JSON.stringify({ reminders: false }));
    }, homelab);
    const shot = async (name) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}${name}.png` });
      console.log(`wrote docs/images/${name}.png`);
    };

    await page.goto(BASE);
    await page.locator('.task-row').first().waitFor();
    await shot('prax-tasks');

    await page.locator('[data-action="set-tab"][data-tab="board"]').click();
    await page.locator('.board').waitFor();
    await shot('prax-board');

    await page.locator('.places [data-action="nav-today"]').click();
    await page.locator('[data-triage]').waitFor();
    await shot('prax-today');

    await page.locator('.places [data-action="nav-library"]').click();
    await page.locator('.doc-card').first().waitFor();
    await shot('prax-library');

    await page.locator('.panel__foot [data-action="nav-settings"]').click();
    await page.locator('.settings-card__title').first().waitFor();
    // The light Paper theme (Graphite is the default): the same toggle the
    // titlebar offers.
    await page.locator('[data-action="toggle-theme"]').click();
    await page.waitForFunction(() => document.body.getAttribute('data-theme') === 'light');
    await shot('prax-settings');
  } finally {
    await browser.close();
    server.kill();
  }
}

await capture();
