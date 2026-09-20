import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateJob, executeTemplateJob, saveTemplateDraft, loadTemplateDraft, templateChoices } from '../../public/js/templateUse.js';
import { renderTemplateStudioHtml } from '../../public/js/renderTemplateStudio.js';
import { renderEditorHtml } from '../../public/js/renderEditor.js';
const source = { id: 'document:master', sourceId: 'master', title: 'Example', label: 'Example', target: 'document', body: '# Original', tags: ['architecture'] };
const draft = { source, title: 'My copy', project: 'target', documentType: 'reference', job: null };

test('template copies carry content and tags, never verification, source identity or lifecycle', () => {
  const [choice] = templateChoices([], [{ id: 'master', title: 'Master', body: 'Text', tags: ['template', 'ops'], documentType: 'template', status: 'active', revision: 'r1', verified: true }]);
  const job = buildTemplateJob({ ...draft, source: choice }, 'new-id');
  assert.equal(job.payload.id, 'new-id'); assert.equal(job.payload.body, 'Text');
  assert.equal(job.payload.kind, 'synthesized'); assert.deepEqual(job.payload.tags, ['ops']);
  assert.equal(job.payload.verified, false);
  for (const field of ['status', 'sourceId', 'revision']) assert.equal(job.payload[field], undefined);
  assert.deepEqual(templateChoices([], [{ documentType: 'template', status: 'superseded' }, { documentType: 'template', archivedAt: 'now' }]), []);
});

test('lost document response reconciles the current copy without overwriting a later edit', async () => {
  const job = buildTemplateJob(draft, 'new-id');
  const result = await executeTemplateJob(job, {
    createDocument: async () => { throw new TypeError('Response lost'); },
    fetchDocument: async id => ({ id, body: 'Newer body', verified: true }),
  });
  assert.equal(result.record.body, 'Newer body'); assert.equal(result.record.verified, true);
});

test('unknown outcome keeps the exact snapshot and identity through reload', async () => {
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  const job = buildTemplateJob(draft, 'stable-id');
  saveTemplateDraft(storage, { ...draft, job, pending: true });
  await assert.rejects(executeTemplateJob(job, { createDocument: async () => { throw Error('Offline'); }, fetchDocument: async () => { throw Error('Offline'); } }), /Offline/);
  const restored = loadTemplateDraft(storage); assert.deepEqual(restored.job, job); assert.equal(restored.pending, false); assert.match(restored.error, /interrupted/);
  assert.throws(() => saveTemplateDraft(null, draft));
});

test('chooser escapes content labels, locks uncertain intent and exposes a labelled preview', () => {
  const html = renderTemplateStudioHtml({ ...draft, source: { ...source, label: '<img onerror=x>' }, job: {} }, [{ ...source, label: '<img onerror=x>' }], [{ id: 'target', name: 'Project' }], '<p>Safe preview</p>');
  assert.match(html, /&lt;img onerror=x&gt;/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /aria-modal="true"/); assert.match(html, /aria-label="Template preview"/);
  assert.match(html, /data-template-field="title"[^>]*disabled/); assert.match(html, /Retry creation/);
});

test('only active saved templates expose Use template', () => {
  const doc = { id: 'master', title: 'Master', body: '', documentType: 'template', status: 'active', tags: [] };
  const state = { editorMode: 'edit' };
  assert.match(renderEditorHtml(state, doc, {}), /data-action="use-document-template"/);
  assert.doesNotMatch(renderEditorHtml(state, { ...doc, status: 'deprecated' }, {}), /data-action="use-document-template"/);
});
