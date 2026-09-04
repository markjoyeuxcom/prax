import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// Root-review finding 5: the Document-info form is an explicit draft. Typed
// metadata survives a failed save and a rerender, only changed fields are
// sent against the captured baseline, and a stale baseline (someone else
// changed the document) yields a review/retry choice that cannot silently
// overwrite the remote title or discard the remote body.

async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: titleText });
  await expect(card).toBeVisible();
  await card.click();
}

async function openInfoForm(page) {
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="edit-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toBeVisible();
}

test('typed Document-info fields survive a failed save and are saved unchanged on retry', async ({ page, request }) => {
  const prefix = `doc-info-fail-${Date.now()}`;
  const projectId = await resolveProjectId(request, 'homelab');
  const doc = await createDocument(request, { title: `${prefix} original`, body: '# doc\n\noriginal body\n', documentType: 'note', project: projectId, tags: ['e2e'] });
  await openLibraryDoc(page, doc.title);
  await openInfoForm(page);

  const patches = [];
  let failNext = true;
  await page.route(`**/api/library/documents/${doc.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches.push(route.request().postDataJSON());
    if (failNext) { failNext = false; return route.abort('failed'); }
    return route.continue();
  });

  await page.locator('[data-doc-info-title]').fill(`${prefix} renamed`);
  await page.locator('[data-doc-info-tags]').fill('alpha, beta');
  await page.locator('[data-doc-info-source]').fill('renamed.md');
  await page.locator('[data-action="save-document-info"]').click();

  // The failure is reported, the form stays open, and every typed value is intact.
  await expect(page.locator('.editor-info__error')).toBeVisible();
  await expect(page.locator('[data-doc-info-title]')).toHaveValue(`${prefix} renamed`);
  await expect(page.locator('[data-doc-info-tags]')).toHaveValue('alpha, beta');
  await expect(page.locator('[data-doc-info-source]')).toHaveValue('renamed.md');
  expect(patches[0]).not.toHaveProperty('documentType');
  expect(patches[0]).not.toHaveProperty('project');
  expect(patches[0].ifRevision).toBe(doc.revision);

  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);
  const stored = await (await request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(`${prefix} renamed`);
  expect(stored.tags).toEqual(['alpha', 'beta']);
  expect(stored.sourceFilename).toBe('renamed.md');
  expect(stored.body).toBe('# doc\n\noriginal body\n');
  expect(patches.length).toBe(2);
});

test('a stale Document-info baseline keeps typed values and needs an explicit choice; the remote body is never discarded', async ({ page, request }) => {
  const prefix = `doc-info-conflict-${Date.now()}`;
  const projectId = await resolveProjectId(request, 'homelab');
  const doc = await createDocument(request, { title: `${prefix} original`, body: '# doc\n\noriginal body\n', documentType: 'note', project: projectId, tags: ['e2e'] });
  await openLibraryDoc(page, doc.title);
  await openInfoForm(page);

  // Another client renames the document and rewrites its body while the form is open.
  const remote = await request.patch(`/api/library/documents/${doc.id}`, { data: { title: `${prefix} remote`, body: '# doc\n\nremote body\n' } });
  expect(remote.ok()).toBe(true);

  await page.locator('[data-doc-info-title]').fill(`${prefix} mine`);
  await page.locator('[data-doc-info-tags]').fill('kept');
  await page.locator('[data-action="save-document-info"]').click();

  // Conflict review: both titles are shown, nothing typed is lost, nothing was written.
  const review = page.locator('[data-doc-info-conflict]');
  await expect(review).toBeVisible();
  await expect(review).toContainText(`${prefix} remote`);
  await expect(page.locator('[data-doc-info-title]')).toHaveValue(`${prefix} mine`);
  await expect(page.locator('[data-doc-info-tags]')).toHaveValue('kept');
  let stored = await (await request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(`${prefix} remote`);
  expect(stored.tags).toEqual(['e2e']);

  // Keeping mine is an explicit choice; it still cannot touch the remote body.
  await page.locator('[data-action="doc-info-keep-mine"]').click();
  await expect(review).toHaveCount(0);
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);
  stored = await (await request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(`${prefix} mine`);
  expect(stored.tags).toEqual(['kept']);
  expect(stored.body).toBe('# doc\n\nremote body\n');
  // The editor now shows the remote body, so the next body autosave cannot restore the old one.
  await expect(page.locator('[data-document-editor]')).toHaveValue('# doc\n\nremote body\n');
  await expect(page.locator('[data-doc-title]')).toHaveValue(`${prefix} mine`);
});

test('keeping the remote values resolves a conflict without resending the contested field', async ({ page, request }) => {
  const prefix = `doc-info-theirs-${Date.now()}`;
  const projectId = await resolveProjectId(request, 'homelab');
  const doc = await createDocument(request, { title: `${prefix} original`, body: '# doc\n', documentType: 'note', project: projectId, tags: ['e2e'] });
  await openLibraryDoc(page, doc.title);
  await openInfoForm(page);
  await request.patch(`/api/library/documents/${doc.id}`, { data: { title: `${prefix} remote` } });
  await page.locator('[data-doc-info-title]').fill(`${prefix} mine`);
  await page.locator('[data-doc-info-tags]').fill('kept');
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-conflict]')).toBeVisible();
  await page.locator('[data-action="doc-info-keep-theirs"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveValue(`${prefix} remote`);
  await expect(page.locator('[data-doc-info-tags]')).toHaveValue('kept');
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);
  const stored = await (await request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(`${prefix} remote`);
  expect(stored.tags).toEqual(['kept']);
});

test('a library refresh failure after a committed Document-info save is not a failed save', async ({ page }) => {
  const prefix = `doc-info-lost-refresh-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const doc = await createDocument(page.request, {
    title: `${prefix} original`, body: '# doc\n\nbody\n', documentType: 'note', project: projectId, tags: ['e2e'],
  });
  const renamed = `${prefix} renamed`;
  let patched = false;
  let refreshAborts = 0;
  await page.route('**/api/library/documents**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'PATCH' && pathname === `/api/library/documents/${doc.id}`) {
      patched = true;
      await route.continue();
      return;
    }
    // The PATCH commits; the collection refresh that follows it is lost.
    if (patched && refreshAborts === 0 && request.method() === 'GET' && pathname === '/api/library/documents') {
      refreshAborts += 1;
      await route.abort();
      return;
    }
    await route.continue();
  });

  await openLibraryDoc(page, doc.title);
  await openInfoForm(page);
  await page.locator('[data-doc-info-title]').fill(renamed);
  await page.locator('[data-action="save-document-info"]').click();

  // A lost refresh must not masquerade as a failed write or strand the form
  // pending: the form closes, the committed title stands in the editor, and
  // the refresh failure is reported on its own.
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);
  await expect(page.locator('[data-doc-title]')).toHaveValue(renamed);
  await expect(page.locator('.toast')).toContainText('could not be refreshed');
  expect(refreshAborts).toBe(1);
  const stored = await (await page.request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(renamed);
});

test('a failed reference write after a committed metadata save keeps the reference list and retries only the references', async ({ page }) => {
  const prefix = `doc-info-refs-fail-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const doc = await createDocument(page.request, {
    title: `${prefix} original`, body: '# doc\n\nbody\n', documentType: 'note', project: projectId, tags: ['e2e'],
  });
  const renamed = `${prefix} renamed`;
  const refUrl = `https://example.com/${prefix}/pr/1`;
  const patches = [];
  let refPosts = 0;
  await page.route(`**/api/library/documents/${doc.id}`, async (route) => {
    if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route(`**/api/library/documents/${doc.id}/external-refs`, async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    refPosts += 1;
    if (refPosts === 1) { await route.abort(); return; }
    await route.continue();
  });

  await openLibraryDoc(page, doc.title);
  await openInfoForm(page);
  await page.locator('[data-doc-info-title]').fill(renamed);
  await page.locator('[data-doc-info-refs]').fill(`${refUrl} | The PR`);
  await page.locator('[data-action="save-document-info"]').click();

  // Metadata committed; the reference write failed. The form stays open with
  // the typed reference kept, says so truthfully, and Save is usable again.
  const error = page.locator('.editor-info__error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('reference');
  await expect(page.locator('[data-doc-info-refs]')).toHaveValue(`${refUrl} | The PR`);
  await expect(page.locator('[data-doc-info-title]')).toHaveValue(renamed);
  await expect(page.locator('[data-action="save-document-info"]')).toBeEnabled();
  expect((await (await page.request.get(`/api/library/documents/${doc.id}`)).json()).title).toBe(renamed);

  // The retry sends only the reference: the metadata baseline already advanced.
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);
  expect(patches).toHaveLength(1);
  expect(refPosts).toBe(2);
  const refs = await (await page.request.get(`/api/library/documents/${doc.id}/external-refs`)).json();
  expect(refs.map((ref) => ref.url)).toEqual([refUrl]);
});
