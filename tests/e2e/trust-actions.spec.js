import { test, expect } from '@playwright/test';
import { seedTrustPair } from './helpers/seed.js';

// Open the library and click the card whose title contains `titleText` —
// documents open in the editor screen.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: titleText });
  await expect(card).toBeVisible();
  await card.click();
}

async function replaceEditorBody(page, body) {
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(body);
  await expect(page.locator('[data-document-editor]')).toHaveValue(body);
}

test('reviewed human revision retains verification while an agent revision revokes it', async ({ page }) => {
  const prefix = `trust-verify-${Date.now()}`;
  const { primary } = await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  await page.locator('[data-action="toggle-doc-menu"]').click();
  let menu = page.locator('.menu__panel');
  let verifyBtn = menu.locator('[data-action="toggle-verify"]');

  // The seeded (agent-written) doc starts unverified.
  await expect(verifyBtn).toHaveText('Verify');
  await expect(page.locator('.editor-head__tags .chip--verified')).toHaveCount(0);
  await expect(menu.locator('.menu__meta')).toContainText('unverified');

  // Let the doc's links load so a late re-render can't swallow the click.
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await verifyBtn.click();

  // Verifying shows the header chip; reopening the menu reflects trust metadata.
  await expect(page.locator('.editor-head__tags .chip--verified')).toBeVisible();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  menu = page.locator('.menu__panel');
  verifyBtn = menu.locator('[data-action="toggle-verify"]');
  await expect(verifyBtn).toHaveText('Unverify');
  await expect(menu.locator('.menu__meta')).toContainText('verified by');

  // The person edits the exact text in the reviewed editor path. That remains
  // a human-origin write and may retain the verification they just granted.
  await page.locator('[data-action="toggle-doc-menu"]').click();
  const reviewedBody = '# primary\n\nHuman-reviewed revision.\n';
  await replaceEditorBody(page, reviewedBody);
  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');
  let canonical = await (await page.request.get(`/api/library/documents/${primary.id}`)).json();
  expect(canonical.body).toBe(reviewedBody);
  expect(canonical.verified).toBe(true);
  expect(canonical.updatedBy).toBe('user');

  // An autonomous/agent-origin edit did not expose its resulting text to the
  // verifier, so the persistence boundary must revoke inherited trust.
  const agentEdit = await page.request.patch(`/api/library/documents/${primary.id}`, {
    headers: { 'x-prax-origin': 'agent' },
    data: { body: '# primary\n\nUnreviewed agent revision.\n' },
  });
  expect(agentEdit.ok()).toBe(true);
  canonical = await agentEdit.json();
  expect(canonical.updatedBy).toBe('agent');
  expect(canonical.verified).toBe(false);
  expect(canonical.verifiedAt).toBeNull();
  expect(canonical.verifiedBy).toBeNull();

  await page.locator('[data-action="back-to-library"]').click();
  await page.locator('.doc-card', { hasText: primary.title }).click();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await expect(page.locator('.menu__panel [data-action="toggle-verify"]')).toHaveText('Verify');
  await expect(page.locator('.menu__panel .menu__meta')).toContainText('updated by agent');
});

test('supersession is retrievable, undoable, and coherent through archive, restore, and delete', async ({ page }) => {
  const prefix = `trust-supersede-${Date.now()}`;
  const { primary, replacement } = await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  await expect(page.locator('[data-document-links]')).toBeVisible();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="supersede-document"]').click();

  const picker = page.locator('[data-link-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#link-picker-title')).toContainText('Supersede');
  await picker.locator('[data-link-picker-doc]', { hasText: `${prefix} replacement` }).click();

  // The old (still-open) doc flips to superseded: chip + menu action gone.
  await expect(page.locator('.editor-head__tags .chip--superseded')).toBeVisible();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await expect(page.locator('.menu__panel .menu__meta')).toContainText('unverified');
  await expect(page.locator('.menu__panel [data-action="supersede-document"]')).toHaveCount(0);

  // The replacement appears under Backlinks (supersede link is new → old, inbound on the old doc).
  const links = page.locator('[data-document-links]');
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} replacement`);

  // Back in the library, the old card carries the SUPERSEDED chip.
  await page.locator('[data-action="back-to-library"]').click();
  const oldCard = page.locator('.doc-card', { hasText: `${prefix} primary` });
  await expect(oldCard.locator('.chip--superseded')).toBeVisible();

  let active = await (await page.request.get('/api/library/documents?status=active')).json();
  expect(active.some(doc => doc.id === primary.id)).toBe(false);

  // The exact replacement edge is reversible from the human flow.
  await expect(page.locator('[data-action="toast-undo"]')).toHaveText('Undo');
  await page.locator('[data-action="toast-undo"]').click();
  await expect(oldCard.locator('.chip--superseded')).toHaveCount(0);
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('active');
  const replacementLinks = await (await page.request.get(`/api/library/documents/${replacement.id}/links?direction=outbound`)).json();
  expect(replacementLinks.some(link => link.documentId === primary.id && link.relation === 'supersedes')).toBe(false);

  // Re-establish the relation, then archive the replacement. The predecessor
  // becomes active; Restore re-applies the still-durable relation.
  await oldCard.click();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="supersede-document"]').click();
  await page.locator('[data-link-picker-doc]', { hasText: replacement.title }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.locator('[data-document-links] .doc-row', { hasText: replacement.title }).click();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="archive-document"]').click();
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('active');
  await expect(page.locator('.toast')).toContainText('Document archived');
  await page.locator('[data-action="toast-undo"]').click();
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('superseded');

  // Permanent deletion is explicitly confirmed and its FK cascade releases
  // the predecessor into default active retrieval with no dangling link.
  const replacementCard = page.locator('.doc-card', { hasText: replacement.title });
  await replacementCard.click();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="delete-document"]').click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm' });
  await expect(confirm).toContainText('cannot be undone');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  expect((await page.request.get(`/api/library/documents/${replacement.id}`)).status()).toBe(404);
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('active');
  active = await (await page.request.get('/api/library/documents?status=active')).json();
  expect(active.some(doc => doc.id === primary.id)).toBe(true);
});

test('a lost supersession response is reconciled once from the exact link and target', async ({ page }) => {
  const prefix = `trust-lost-supersede-${Date.now()}`;
  const { primary, replacement } = await seedTrustPair(page.request, prefix);
  let posts = 0;
  await openLibraryDoc(page, primary.title);
  await page.route(`**/api/library/documents/${primary.id}/supersede`, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected lost supersession response' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="supersede-document"]').click();
  await page.locator('[data-link-picker-doc]', { hasText: replacement.title }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await expect(page.locator('.editor-head__tags .chip--superseded')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('confirmed the result after the response was interrupted');
  await expect(page.locator('.toast')).not.toContainText('could not supersede');
  expect(posts).toBe(1);
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('superseded');
  const links = await (await page.request.get(`/api/library/documents/${replacement.id}/links?direction=outbound`)).json();
  expect(links.filter(link => link.documentId === primary.id && link.relation === 'supersedes')).toHaveLength(1);
});

test('an unreadable supersession outcome blocks retry until reload', async ({ page }) => {
  const prefix = `trust-unknown-supersede-${Date.now()}`;
  const { primary, replacement } = await seedTrustPair(page.request, prefix);
  let posts = 0;
  await openLibraryDoc(page, primary.title);
  const supersedePattern = `**/api/library/documents/${primary.id}/supersede`;
  const detailPattern = `**/api/library/documents/${primary.id}`;
  await page.route(supersedePattern, async (route) => {
    posts += 1;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected pre-commit supersession failure' }),
    });
  });
  await page.route(detailPattern, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected readback failure' }),
      });
      return;
    }
    await route.continue();
  });

  const attempt = async () => {
    await page.locator('[data-action="toggle-doc-menu"]').click();
    await page.locator('.menu__panel [data-action="supersede-document"]').click();
    await page.locator('[data-link-picker-doc]', { hasText: replacement.title }).click();
  };
  await attempt();
  await expect(page.locator('[data-link-picker]')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Reload before retrying');
  expect(posts).toBe(1);

  // A second activation in the same page is guarded because the first outcome
  // could not be read back. Reload is the only safe way to clear uncertainty.
  await attempt();
  await expect(page.locator('.toast')).toContainText('still has an unconfirmed lifecycle outcome');
  expect(posts).toBe(1);

  await page.unroute(supersedePattern);
  await page.unroute(detailPattern);
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).status).toBe('active');
});

test('a committed verification remains visible when the collection refresh fails', async ({ page }) => {
  const prefix = `trust-refresh-verify-${Date.now()}`;
  const { primary } = await seedTrustPair(page.request, prefix);
  let verified = false;
  let refreshFailed = false;
  await openLibraryDoc(page, primary.title);
  await page.route('**/api/library/documents**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === `/api/library/documents/${primary.id}/verify`) {
      const response = await route.fetch();
      verified = true;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() === 'GET'
      && url.pathname === '/api/library/documents'
      && verified
      && !refreshFailed) {
      refreshFailed = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected library refresh failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="toggle-verify"]').click();
  await expect(page.locator('.editor-head__tags .chip--verified')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Verification completed, but the library could not refresh');
  await expect(page.locator('.toast')).not.toContainText('could not verify');
  expect(refreshFailed).toBe(true);
  expect((await (await page.request.get(`/api/library/documents/${primary.id}`)).json()).verified).toBe(true);
});
