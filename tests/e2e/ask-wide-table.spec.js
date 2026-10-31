import { test, expect } from '@playwright/test';

// On a wide window an answer's table uses the room beside the reading column
// instead of squeezing a column to one character per line; the text, the
// question and the composer keep the 740px measure and line up.
test('Ask page: a wide answer table breaks out of the reading column', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 1130 });
  await page.request.put('/api/settings/ai-answers', { data: { backend: 'fake' } });
  const sources = [{ id: 's1', title: 'Prax release process', documentType: 'runbook', verified: false, status: 'active', kind: 'source' }];
  const answer = [
    'Releases that failed [Prax release process].', '',
    '| Release | What happened | Cause | Rule that followed |',
    '|---|---|---|---|',
    '| v0.37.0 (candidate) | Withheld | A symlinked backup/restore command silently performed no restore | Rehearse backup/restore with the packaged Node executable, including via a symlinked path, and require a JSON success report |',
    '| v0.39.1 | Tag died in CI | The `npm audit` gate failed | Run `npm audit --audit-level=high` locally before tagging |',
  ].join('\n');
  await page.route('**/api/library/ask', (route) => route.fulfill({ json: {
    query: 'Which releases failed?', answer, degraded: false, markdown: '', sources,
    retrieval: { mode: 'semantic', fallback: false, reason: null },
    citation: { valid: true, citations: ['Prax release process'], unknown: [] }, model: 'fake',
  } }));
  await page.goto('/');
  await page.locator('[data-action="open-ask-page"]').first().click();
  await page.locator('[data-ask-page-input]').fill('Which releases failed?');
  await page.locator('[data-action="run-ask-prax"]').click();
  const table = page.locator('.ask-answer table');
  await expect(table).toBeVisible();

  const text = await page.locator('.ask-answer p').first().boundingBox();
  const question = await page.locator('.ask-q').boundingBox();
  const composer = await page.locator('.ask-composer').boundingBox();
  const tableBox = await table.boundingBox();
  expect(Math.round(text.width)).toBe(740);
  expect(Math.round(composer.width)).toBe(740);
  expect(Math.round(question.x + question.width)).toBe(Math.round(text.x + text.width)); // the bubble ends where the text does
  expect(tableBox.width).toBeGreaterThan(text.width + 200);

  // No cell breaks a word: the first column is at least as wide as "v0.37.0".
  const firstCell = await page.locator('.ask-answer td').first().evaluate((td) => ({ width: td.clientWidth, scroll: td.scrollWidth }));
  expect(firstCell.scroll).toBeLessThanOrEqual(firstCell.width);
  // "Release" sits on one line, not one letter per line.
  const lines = await page.locator('.ask-answer th').first().evaluate((th) => {
    const range = document.createRange();
    range.selectNodeContents(th);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(lines).toBe(1);
});
