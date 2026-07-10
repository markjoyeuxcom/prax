import { isDocumentType } from '../../public/js/documentTypes.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { DOCUMENT_TEMPLATES, templateById } from '../../public/js/documentTemplates.js';

test('every template carries id, label, documentType, title, and body', () => {
  assert.ok(DOCUMENT_TEMPLATES.length >= 2);
  for (const t of DOCUMENT_TEMPLATES) {
    assert.equal(typeof t.id, 'string');
    assert.equal(typeof t.label, 'string');
    assert.ok(isDocumentType(t.documentType));
    assert.equal(typeof t.title, 'string');
    assert.equal(typeof t.body, 'string');
  }
});

test('the runbook template seeds the section skeleton', () => {
  const runbook = templateById('runbook');
  assert.equal(runbook.documentType, 'runbook');
  for (const heading of ['## Symptoms', '## Diagnosis', '## Resolution', '## Verification', '## Rollback']) {
    assert.ok(runbook.body.includes(heading), `runbook body missing ${heading}`);
  }
  assert.match(runbook.body, /^# /); // starts with a title heading
});

test('the blank-note template is minimal', () => {
  const note = templateById('note');
  assert.equal(note.documentType, 'note');
  assert.doesNotMatch(note.body, /## /);
});

test('templateById falls back to the blank note for unknown or missing ids', () => {
  assert.equal(templateById('nope').id, 'note');
  assert.equal(templateById(undefined).id, 'note');
  assert.equal(templateById('').id, 'note');
});
