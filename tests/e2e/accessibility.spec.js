import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDocument, resolveProjectId } from './helpers/seed.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page, stateName) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.locator('body').evaluate((body, value) => body.setAttribute('data-theme', value), theme);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    await test.info().attach(`axe-${stateName}-${theme}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
    const summary = results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      count: violation.nodes.length,
      targets: violation.nodes.slice(0, 30).map((node) => node.target.join(' ')),
      examples: violation.nodes.slice(0, 5).map((node) => node.any?.[0]?.message || node.failureSummary),
    }));
    expect.soft(
      results.violations.length,
      `${stateName} (${theme}) WCAG violations:\n${JSON.stringify(summary, null, 2)}`,
    ).toBe(0);
  }
  await page.locator('body').evaluate((body) => body.setAttribute('data-theme', 'light'));
}

async function createTask(request, prefix) {
  const response = await request.post('/api/tasks', {
    data: {
      title: `${prefix} task`,
      description: 'Production-rendered accessibility fixture',
      notes: 'Keyboard and assistive technology evidence.',
      project: 'inbox',
      priority: 'high',
      status: 'planned',
      labels: ['accessibility'],
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('task collection, detail, and quick capture have no automatic WCAG A/AA violations', async ({ page }) => {
  const task = await createTask(page.request, `a11y-task-${Date.now()}`);
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');

  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await expect(page.locator('.task-row', { hasText: task.title })).toBeVisible();
  await audit(page, 'task-collection');

  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator(`.drawer[data-task-id="${task.id}"]`)).toBeVisible();
  await audit(page, 'task-detail');

  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-capture"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
  await audit(page, 'quick-capture');
});

test('Library collection, editor, and runbook operation have no automatic WCAG A/AA violations', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const prefix = `a11y-library-${Date.now()}`;
  const runbook = await createDocument(page.request, {
    title: `${prefix} failover runbook`,
    body: '# Failover\n\n- [ ] Stop writes\n- [ ] Promote replica\n- [ ] Verify traffic\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['accessibility'],
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: runbook.title });
  await expect(card).toBeVisible();
  await audit(page, 'library-collection');

  await card.click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(runbook.title);
  await audit(page, 'document-editor');

  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.locator('.run .chip--run-running')).toBeVisible();
  await audit(page, 'runbook-operation');
});

test('Settings and data-transfer dialogs have no automatic WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-action="nav-settings"]').first().click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  for (const [tab, name] of [['appearance', 'Appearance'], ['intelligence', 'Intelligence'], ['data', 'Data & admin']]) {
    await page.locator(`[data-action="set-settings-tab"][data-tab="${tab}"]`).click();
    await expect(page.getByRole('button', { name })).toHaveAttribute('aria-current', 'true');
    await audit(page, `settings-${tab}`);
  }

  await page.locator('[data-action="nav-library"]').first().click();
  // Import and Export live in the Library's ⋯ overflow.
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="import-documents"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Import Markdown' })).toBeVisible();
  await audit(page, 'markdown-import-dialog');
  await page.getByRole('button', { name: 'Close Markdown import' }).click();

  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="export-library"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Export Library' })).toBeVisible();
  await audit(page, 'library-export-dialog');
});

test('every selectable accent remains WCAG-safe in both themes', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator('[data-action="set-settings-tab"][data-tab="appearance"]').click();

  const accents = await page.locator('[data-action="set-accent"]').evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute('data-accent')).filter(Boolean)
  ));
  expect(accents.length).toBeGreaterThan(1);
  for (const accent of accents) {
    await page.locator(`[data-action="set-accent"][data-accent="${accent}"]`).click();
    await expect(page.locator(`[data-action="set-accent"][data-accent="${accent}"]`)).toHaveClass(/is-active/);
    await audit(page, `settings-accent-${accent}`);
  }
});
