import { test, expect } from '@playwright/test';

// The Today plan & shutdown ritual, end to end against the production app:
// plan two tasks, complete one, shut down — the survivor demands a decision;
// carrying it rolls the plan to tomorrow with the carry chronicled. A stale
// (never-shut-down) plan surfaces as the morning banner.

function localISO(daysFromNow = 0) {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function createTask(request, payload) {
  const response = await request.post('/api/tasks', {
    data: { project: 'inbox', priority: 'medium', status: 'planned', ...payload },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('plan -> complete one -> shutdown walks the survivor -> carry rolls it to tomorrow', async ({ page, request }) => {
  const prefix = `plan-ritual-${Date.now()}`;
  const doneTask = await createTask(request, { title: `${prefix} finish me`, dueDate: localISO(0) });
  const carryTask = await createTask(request, { title: `${prefix} carry me`, dueDate: localISO(0) });

  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  // Morning pass: both due-today tasks offered; pull both into the plan.
  await page.locator('[data-action="open-plan-mode"]').first().click();
  const dialog = page.locator('[data-overlay="planmode"]');
  await expect(dialog).toBeVisible();
  // The queue holds every earlier spec's seeds on the shared server, and only
  // the end-of-queue summary offers the Done button — so walk it just until
  // our two are in (overdue and today come first, so that is quick), then
  // leave with Escape, which closes plan mode from any card. The click
  // handlers are async (each decision is a PATCH + re-render), so after every
  // action wait for the progress counter to move before reading the next card.
  let added = 0;
  for (let guard = 0; guard < 120 && added < 2; guard += 1) {
    const progress = await dialog.locator('.planmode__progress')
      .innerText({ timeout: 1500 })
      .catch(() => null);
    if (progress === null) break; // end-of-queue summary
    const cardText = await dialog.locator('.planmode__title').innerText();
    if (cardText.includes(prefix)) {
      await dialog.locator('[data-action="plan-mode-add"], [data-action="plan-mode-today"]').first().click();
      added += 1;
    } else {
      await dialog.locator('[data-action="plan-mode-skip"]').click();
    }
    await expect(async () => {
      const now = await dialog.locator('.planmode__progress').innerText({ timeout: 500 }).catch(() => null);
      expect(now).not.toBe(progress);
    }).toPass({ timeout: 5000 });
  }
  expect(added).toBe(2);
  if (await dialog.locator('.planmode__progress').count()) {
    await page.keyboard.press('Escape');
  } else {
    await dialog.locator('[data-action="close-plan-mode"]').last().click();
  }
  await expect(dialog).toHaveCount(0);

  // The Planned section leads Today with both tasks and the honest score.
  await expect(page.locator('[data-plan-score]')).toContainText('planned 2 — 0 done');
  const plannedRows = page.locator('[data-group="planned"] .task-row');
  await expect(plannedRows.filter({ hasText: `${prefix} finish me` })).toBeVisible();

  // Complete one.
  await plannedRows.filter({ hasText: `${prefix} finish me` }).locator('[data-action="toggle-task-done"]').click();
  await expect(page.locator('[data-plan-score]')).toContainText('planned 2 — 1 done');

  // Shutdown: only the survivor is walked; carry it.
  await page.locator('[data-action="open-shutdown"]').first().click();
  await expect(dialog.locator('.planmode__title')).toHaveText(`${prefix} carry me`);
  await dialog.locator('[data-action="shutdown-carry"]').click();
  await expect(dialog).toContainText('Day closed.');
  await expect(dialog).toContainText('1 done today · 1 carried');
  await dialog.locator('[data-action="close-plan-mode"]').last().click();

  // The carry is server-truth: plannedFor moved to tomorrow, carryCount 1,
  // and the chronicle recorded it.
  const carried = await (await request.get(`/api/tasks/${carryTask.id}`)).json();
  expect(carried.plannedFor).toBe(localISO(1));
  expect(carried.carryCount).toBe(1);
  const activity = await (await request.get(`/api/tasks/${carryTask.id}/activity`)).json();
  expect(activity.some((event) => event.eventType === 'carried')).toBe(true);
  // Today's plan no longer shows it.
  await expect(page.locator('[data-plan-score]')).toContainText('planned 1 — 1 done');
  expect(doneTask.id).toBeTruthy();
});

test('a never-shut-down plan surfaces as the stale banner and Review offers a verdict', async ({ page, request }) => {
  const title = `stale-plan-${Date.now()}`;
  const stale = await createTask(request, { title });
  await request.patch(`/api/tasks/${stale.id}`, { data: { plannedFor: localISO(-1) } });

  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  const banner = page.locator('[data-stale-plan]');
  await expect(banner).toContainText('planned on an earlier day and never shut down');
  await banner.locator('[data-action="open-plan-mode"]').click();

  const dialog = page.locator('[data-overlay="planmode"]');
  // Stale items are walked FIRST with the move/drop verdict.
  await expect(dialog.locator('.planmode__bucket')).toContainText('never shut down');
  await expect(dialog.locator('.planmode__title')).toHaveText(title);
  await dialog.locator('[data-action="plan-mode-today"]').click();

  // Moving a stale plan forward is a carry — the day still moved.
  const reviewed = await (await request.get(`/api/tasks/${stale.id}`)).json();
  expect(reviewed.plannedFor).toBe(localISO(0));
  expect(reviewed.carryCount).toBe(1);
});
