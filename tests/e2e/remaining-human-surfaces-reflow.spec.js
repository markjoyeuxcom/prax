import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

test.use({
  viewport: { width: 320, height: 800 },
  hasTouch: true,
  isMobile: true,
});

async function expectNoHorizontalOverflow(locator, label) {
  const measurement = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(
    measurement.scrollWidth,
    `${label} overflows horizontally: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.clientWidth + 1);
  expect(
    measurement.documentWidth,
    `${label} widens the document: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.viewportWidth + 1);
}

async function openRunbook(page, runbook) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().tap();
  await page.locator('.doc-card', { hasText: runbook.title }).tap();
  await expect(page.locator('[data-doc-title]')).toHaveValue(runbook.title);
  await page.getByRole('button', { name: '▶ Run' }).tap();
  await expect(page.locator('.run .chip--run-running')).toBeVisible();
}

test('running and terminal runbooks reflow while a narrow step mutation remains canonical', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const prefix = `run-reflow-${Date.now()}`;
  const firstStepText = 'Stop all application writes and verify every producer has acknowledged the maintenance barrier';
  const runbook = await createDocument(page.request, {
    title: `${prefix} an intentionally long regional database failover runbook`,
    body: `# Regional failover\n\n- [ ] ${firstStepText}\n- [ ] Promote the verified replica and validate traffic across every availability zone\n`,
    documentType: 'runbook',
    project: projectId,
    tags: ['incident-response'],
  });

  await openRunbook(page, runbook);
  await expect(page.getByRole('button', { name: 'Finish run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy chronicle' })).toBeVisible();
  await expectNoHorizontalOverflow(page.locator('.main__scroll'), 'running runbook');

  const firstStep = page.locator('[data-action="toggle-run-step"]').filter({ hasText: firstStepText });
  await firstStep.tap();
  await expect(page.locator('.run-event', { hasText: firstStepText })).toBeVisible();
  const runId = await page.locator('[data-action="finish-run"]').getAttribute('data-run-id');
  const running = await (await page.request.get(`/api/library/runs/${runId}`)).json();
  expect(running.steps.find((step) => step.text === firstStepText)?.checkedAt).toBeTruthy();
  await expectNoHorizontalOverflow(page.locator('.main__scroll'), 'runbook chronicle');

  await page.getByRole('button', { name: 'Finish run' }).tap();
  await expect(page.locator('.run .chip--run-completed')).toBeVisible();
  await expect(page.getByRole('button', { name: '✦ Post-mortem' })).toBeVisible();
  await expectNoHorizontalOverflow(page.locator('.main__scroll'), 'terminal runbook');
});

test('every Settings section keeps its controls inside the 400%-equivalent viewport', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-action="nav-settings"]').first().tap();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  for (const [tab, name] of [['appearance', 'Appearance'], ['intelligence', 'Intelligence'], ['data', 'Data & admin']]) {
    await page.locator(`[data-action="set-settings-tab"][data-tab="${tab}"]`).tap();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'true');
    await expectNoHorizontalOverflow(page.locator('.main__scroll'), `Settings ${name}`);
  }

  await page.locator('[data-action="set-settings-tab"][data-tab="appearance"]').tap();
  const accents = page.locator('[data-action="set-accent"]');
  await expect(accents).toHaveCount(9);
  for (const title of ['Fern (default)', 'Teal', 'Sky', 'Indigo', 'Plum', 'Rose', 'Amber', 'Clay', 'Moss']) {
    await expect(page.getByTitle(title)).toBeVisible();
  }
  const lineNumbers = page.getByRole('switch', { name: 'Editor line numbers' });
  const initial = await lineNumbers.getAttribute('aria-checked');
  await lineNumbers.tap();
  await expect(lineNumbers).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true');
});

test('Markdown import and Library export dialogs contain long controls and parsed state', async ({ page }) => {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => {
      throw new DOMException('Test stops before save.', 'AbortError');
    };
  });
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().tap();

  await page.locator('[data-action="toggle-library-menu"]').tap();
  await page.locator('[data-action="import-documents"]').first().tap();
  const importDialog = page.getByRole('dialog', { name: 'Import Markdown' });
  await importDialog.locator('[data-markdown-import-files]').setInputFiles([
    {
      name: 'an-extremely-long-operational-recovery-document-filename-that-must-not-widen-the-dialog.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# A very long imported operational recovery document title\n\nBody.\n'),
    },
    {
      name: 'second-long-database-failover-checklist-document.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Second database failover checklist\n\nBody.\n'),
    },
  ]);
  await expect(importDialog.locator('[data-markdown-import-summary]')).toContainText('2 files ready');
  await expect(importDialog.getByRole('button', { name: 'Import 2' })).toBeVisible();
  await expect(importDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expectNoHorizontalOverflow(importDialog, 'Markdown import dialog');
  await importDialog.getByRole('button', { name: 'Cancel' }).tap();

  await page.locator('[data-action="toggle-library-menu"]').tap();
  await page.locator('[data-action="export-library"]').first().tap();
  const exportDialog = page.getByRole('dialog', { name: 'Export Library' });
  await expect(exportDialog).toContainText('Browser Save dialog');
  await expect(exportDialog.getByRole('button', { name: 'Choose location & export' })).toBeVisible();
  await expect(exportDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expectNoHorizontalOverflow(exportDialog, 'Library export dialog');
});
