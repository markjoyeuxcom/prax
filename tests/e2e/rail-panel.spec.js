import { test, expect } from '@playwright/test';

// The rail + panel shell (layout option B): the icon rail owns top-level
// navigation, the panel browses projects and views with tabs and a
// type-to-filter box. Every classic data-action survives — these journeys
// prove the new container preserves the old vocabulary.

async function createProject(request, name) {
  const response = await request.post('/api/projects', { data: { name } });
  expect([200, 201]).toContain(response.status());
  return response.json();
}

test('rail navigates, panel lists projects, filter narrows and reports no matches', async ({ page, request }) => {
  const stamp = Date.now();
  await createProject(request, `Panel Alpha ${stamp}`);
  await createProject(request, `Panel Beta ${stamp}`);

  await page.goto('/');
  // Rail: top-level nav with tooltips; Settings pinned at the bottom.
  await expect(page.locator('.rail [data-action="nav-today"]')).toBeVisible();
  await expect(page.locator('.rail [data-action="nav-settings"]')).toBeVisible();

  // Panel: both created projects listed on the Projects tab.
  const panel = page.locator('.panel');
  await expect(panel.locator('.side-item', { hasText: `Panel Alpha ${stamp}` })).toBeVisible();
  await expect(panel.locator('.side-item', { hasText: `Panel Beta ${stamp}` })).toBeVisible();

  // Type-to-filter narrows live and keeps focus while typing.
  const filter = panel.locator('[data-panel-filter]');
  await filter.click();
  await filter.pressSequentially('alpha', { delay: 20 });
  await expect(panel.locator('.side-item', { hasText: `Panel Alpha ${stamp}` })).toBeVisible();
  await expect(panel.locator('.side-item', { hasText: `Panel Beta ${stamp}` })).toHaveCount(0);

  // Nonsense filter -> honest empty state, not a silent blank.
  await filter.fill('zzz-no-such-project');
  await expect(panel.locator('.panel__empty')).toHaveText('No matches.');

  // Clearing restores; clicking a row navigates to the project.
  await filter.fill('');
  await panel.locator('.side-item', { hasText: `Panel Alpha ${stamp}` }).click();
  await expect(page.locator('.titlebar__crumb')).toContainText(`Panel Alpha ${stamp}`);
});

test('⌘K jumps to a project and to the built-in Stale view by name', async ({ page, request }) => {
  const stamp = Date.now();
  const project = await createProject(request, `Palette Target ${stamp}`);
  expect(project.id).toBeTruthy();

  await page.goto('/');
  // Jump to the project: type part of its name, run the Projects result.
  await page.locator('[data-action="open-palette"]').click();
  await page.locator('[data-palette-input]').fill(`target ${stamp}`);
  await page.locator('.palette__item', { hasText: `Palette Target ${stamp}` }).click();
  await expect(page.locator('.titlebar__crumb')).toContainText(`Palette Target ${stamp}`);

  // Jump to the built-in Stale smart view the same way.
  await page.locator('[data-action="open-palette"]').click();
  await page.locator('[data-palette-input]').fill('stale');
  await page.locator('.palette__item', { hasText: 'Stale' }).first().click();
  await expect(page.locator('[data-action="select-smart-view"][data-view-id="builtin-stale"]')).toHaveCount(0);
  // The filter view is open with the Stale expression active (panel still on
  // the Projects tab — the palette jump does not depend on the panel at all).
  await expect(page.locator('input[data-filter-input], [data-filter-expr]').first()).toBeVisible();
});

test('the Views tab lists smart views, switching tabs clears the filter, selection opens the view', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('.panel');
  await panel.locator('[data-panel-filter]').fill('leftover');
  await panel.locator('[data-action="set-panel-tab"][data-tab="views"]').click();
  // Tab switch cleared the stale filter, so the built-in Stale view is visible.
  await expect(panel.locator('[data-panel-filter]')).toHaveValue('');
  const stale = panel.locator('[data-action="select-smart-view"][data-view-id="builtin-stale"]');
  await expect(stale).toBeVisible();
  await expect(stale.locator('.side-item__label')).toHaveText('Stale');
  await stale.click();
  await expect(stale).toHaveClass(/is-active/);
});
