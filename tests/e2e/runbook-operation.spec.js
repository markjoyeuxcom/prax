import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

async function seedRunbook(page, prefix) {
  const project = await resolveProjectId(page.request, 'homelab');
  return createDocument(page.request, {
    title: `${prefix} failover`,
    body: '# Failover\n\n- [ ] Stop writes\n- [ ] Promote replica\n- [ ] Verify traffic\n',
    documentType: 'runbook',
    project,
    tags: ['e2e', 'quality-journey'],
  });
}

async function openRunbook(page, runbook) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: runbook.title });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(runbook.title);
}

async function startRun(page) {
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.locator('.run .chip--run-running')).toBeVisible();
  return page.locator('[data-action="finish-run"]').getAttribute('data-run-id');
}

test('runbook operation survives interruption and reopens with a complete actor-attributed chronicle', async ({ page }) => {
  const runbook = await seedRunbook(page, `runbook-journey-${Date.now()}`);
  await openRunbook(page, runbook);
  const runId = await startRun(page);

  const firstStep = page.locator('[data-action="toggle-run-step"]').filter({ hasText: 'Stop writes' });
  await firstStep.click();
  await expect(page.locator('.run-event', { hasText: 'Checked “Stop writes”' })).toBeVisible();
  await firstStep.click();
  await expect(page.locator('.run-event', { hasText: 'Unchecked “Stop writes”' })).toBeVisible();

  await page.getByRole('button', { name: 'Abort' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm' });
  await confirm.getByRole('button', { name: 'Abort run' }).click();
  await expect(page.locator('.run .chip--run-aborted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume run' })).toBeVisible();
  await expect(page.locator('.run-event', { hasText: 'Run aborted' })).toBeVisible();

  await page.locator('[data-action="back-from-run"]').click();
  const pastRuns = page.getByRole('region', { name: 'Past runs' });
  await expect(pastRuns).toBeVisible();
  await pastRuns.locator(`[data-run-id="${runId}"]`).click();
  await expect(page.locator('.run .chip--run-aborted')).toBeVisible();
  await expect(page.locator('.run-event', { hasText: 'Unchecked “Stop writes”' })).toBeVisible();

  await page.getByRole('button', { name: 'Resume run' }).click();
  await expect(page.locator('.run .chip--run-running')).toBeVisible();
  await expect(page.locator('.run-event', { hasText: 'Run resumed' })).toBeVisible();
  await page.locator('[data-action="toggle-run-step"]').filter({ hasText: 'Stop writes' }).click();
  await page.getByRole('button', { name: 'Finish run' }).click();
  await expect(page.locator('.run .chip--run-completed')).toBeVisible();
  await expect(page.locator('.run-event', { hasText: 'Run completed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume run' })).toHaveCount(0);
  await expect(page.locator('[data-action="toggle-run-step"]').first()).toBeDisabled();

  const canonical = await (await page.request.get(`/api/library/runs/${runId}`)).json();
  expect(canonical.status).toBe('completed');
  expect(canonical.events.map((event) => event.type)).toEqual([
    'started', 'step-checked', 'step-unchecked', 'aborted', 'resumed', 'step-checked', 'completed',
  ]);
  expect(canonical.events.every((event) => event.actor === 'user')).toBe(true);
});

test('a doubled start with a lost response creates one run and one start event', async ({ page }) => {
  const runbook = await seedRunbook(page, `runbook-start-${Date.now()}`);
  let starts = 0;
  let submittedId = null;
  let releaseLostResponse;
  let markStartCommitted;
  const lostResponseGate = new Promise((resolve) => { releaseLostResponse = resolve; });
  const startCommitted = new Promise((resolve) => { markStartCommitted = resolve; });
  await page.route(`**/api/library/documents/${runbook.id}/runs`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    starts += 1;
    submittedId = route.request().postDataJSON().id;
    await route.fetch();
    markStartCommitted();
    await lostResponseGate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected lost start response' }),
    });
  });
  await openRunbook(page, runbook);
  const startButton = page.locator('[data-action="start-run"]');
  await startButton.click();
  await startCommitted;
  await expect(startButton).toBeDisabled();
  await startButton.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  releaseLostResponse();

  await expect(page.locator('.run .chip--run-running')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('confirmed after the response was lost');
  expect(starts).toBe(1);
  expect(submittedId).toMatch(/^[0-9a-f-]{36}$/);
  const runs = await (await page.request.get(`/api/library/documents/${runbook.id}/runs`)).json();
  expect(runs.filter((run) => run.id === submittedId)).toHaveLength(1);
  const canonical = await (await page.request.get(`/api/library/runs/${submittedId}`)).json();
  expect(canonical.events.map((event) => event.type)).toEqual(['started']);
});

test('a delayed step locks Finish and a lost completion response reconciles to terminal state', async ({ page }) => {
  const runbook = await seedRunbook(page, `runbook-serialization-${Date.now()}`);
  await openRunbook(page, runbook);
  const runId = await startRun(page);
  let releaseStep;
  let markStepStarted;
  const stepGate = new Promise((resolve) => { releaseStep = resolve; });
  const stepStarted = new Promise((resolve) => { markStepStarted = resolve; });
  let completionPatches = 0;
  await page.route(`**/api/library/runs/${runId}/steps/*`, async (route) => {
    if (route.request().method() === 'PATCH') {
      markStepStarted();
      await stepGate;
    }
    await route.continue();
  });
  await page.route(`**/api/library/runs/${runId}`, async (route) => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON().status === 'completed') {
      completionPatches += 1;
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected lost completion response' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="toggle-run-step"]').filter({ hasText: 'Promote replica' }).click();
  await stepStarted;
  await expect(page.locator('[data-action="finish-run"]')).toBeDisabled();
  releaseStep();
  await expect(page.locator('[data-action="finish-run"]')).toBeEnabled();
  await page.locator('[data-action="finish-run"]').click();

  await expect(page.locator('.run .chip--run-completed')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('confirmed after the response was lost');
  expect(completionPatches).toBe(1);
  const canonical = await (await page.request.get(`/api/library/runs/${runId}`)).json();
  expect(canonical.events.map((event) => event.type)).toEqual(['started', 'step-checked', 'completed']);
});
