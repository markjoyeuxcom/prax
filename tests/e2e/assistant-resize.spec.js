import { test, expect } from '@playwright/test';

// The assistant panel widens when its left edge is dragged, stays open, keeps
// the width across a reload, and goes back to the default on double-click.
test('assistant panel: drag the left edge to resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const configured = await page.request.put('/api/settings/ai-answers', { data: { backend: 'fake' } });
  expect(configured.ok()).toBe(true);
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('prax.assistantWidth.v1'));
  await page.reload();

  await page.locator('[data-action="open-assistant"]').click();
  const panel = page.locator('aside.asst');
  // The panel renders again once the model status loads, and each render slides
  // it in; hover() waits until the edge stops moving, or the press lands beside it.
  await expect(page.locator('[data-assistant-input]')).toBeEnabled();
  const handle = page.locator('[data-assistant-resize]');
  await handle.hover();
  const before = (await panel.boundingBox()).width;
  const box = await handle.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, y, { steps: 8 });
  await page.mouse.move(box.x - 300, y, { steps: 8 });
  await page.mouse.up();

  await expect(panel).toBeVisible();                                // the drag did not close it
  const after = (await panel.boundingBox()).width;
  expect(after).toBeGreaterThan(before + 250);

  await page.reload();
  await page.locator('[data-action="open-assistant"]').click();
  await expect(page.locator('[data-assistant-input]')).toBeEnabled();
  await expect.poll(async () => Math.round((await page.locator('aside.asst').boundingBox()).width)).toBe(Math.round(after));

  await page.locator('[data-assistant-resize]').dblclick();
  await expect(page.locator('aside.asst')).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('aside.asst').boundingBox()).width)).toBe(Math.round(before));

  // Keyboard: the separator is focusable and arrows widen or narrow it.
  await page.locator('[data-assistant-resize]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await page.locator('aside.asst').boundingBox()).width)).toBe(Math.round(before) + 32);
});
