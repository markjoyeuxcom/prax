import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateDocument, buildUpdateDocument, normalizeDocumentRow, documentMatchesCreateFields,
} from '../../server/libraryRepository.js';

const base = { title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null };

test('normalizeDocumentRow exposes updatedByAgent (null when unset)', () => {
  const row = { id: '1', title: 't', body: 'b', document_type: 'note', project_id: 'p', tags: '[]', updated_by: 'agent', updated_by_agent: 'codex' };
  assert.equal(normalizeDocumentRow(row).updatedByAgent, 'codex');
  assert.equal(normalizeDocumentRow({ ...row, updated_by_agent: null }).updatedByAgent, null);
  assert.equal(normalizeDocumentRow({ ...row, updated_by_agent: undefined }).updatedByAgent, null);
});

test('buildCreateDocument writes updated_by_agent only for an identified agent write', () => {
  const identified = buildCreateDocument({ ...base, updatedBy: 'agent', updatedByAgent: 'codex' });
  assert.match(identified.text, /updated_by_agent\)/);
  assert.equal(identified.values[identified.values.length - 1], 'codex');

  const anonymous = buildCreateDocument({ ...base, updatedBy: 'agent' });
  assert.doesNotMatch(anonymous.text, /updated_by_agent/);

  const human = buildCreateDocument({ ...base, updatedBy: 'user', updatedByAgent: 'codex' });
  assert.doesNotMatch(human.text, /updated_by_agent/);
});

test('buildUpdateDocument sets updated_by_agent when the caller threads it (vendor for agent, null for user)', () => {
  const agent = buildUpdateDocument('id-1', { body: 'x', updatedBy: 'agent', updatedByAgent: 'claude' });
  assert.match(agent.text, /updated_by_agent = \$\d+/);
  assert.ok(agent.values.includes('claude'));

  const human = buildUpdateDocument('id-1', { body: 'x', updatedBy: 'user', updatedByAgent: null });
  assert.match(human.text, /updated_by_agent = \$\d+/);
  assert.equal(human.values[human.values.length - 2], null);

  const untouched = buildUpdateDocument('id-1', { body: 'x' });
  assert.doesNotMatch(untouched.text, /updated_by_agent/);
});

test('documentMatchesCreateFields treats a different agent id as a different creation', () => {
  const fields = { ...base, updatedBy: 'agent', updatedByAgent: 'codex', kind: 'synthesized' };
  assert.equal(documentMatchesCreateFields({ ...fields }, fields), true);
  assert.equal(documentMatchesCreateFields({ ...fields, updatedByAgent: 'claude' }, fields), false);
  assert.equal(documentMatchesCreateFields({ ...fields, updatedByAgent: null }, { ...fields, updatedByAgent: undefined }), true);
});
