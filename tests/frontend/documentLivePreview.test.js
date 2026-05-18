import test from 'node:test';
import assert from 'node:assert/strict';

import { updateDocumentLivePreview } from '../../public/js/documentLivePreview.js';

test('updateDocumentLivePreview renders Markdown into an open split preview', () => {
  const previewNode = { innerHTML: '' };
  const workspace = {
    querySelector(selector) {
      return selector === '.markdown-preview' ? previewNode : null;
    },
  };

  const didUpdate = updateDocumentLivePreview(workspace, '# Live Draft\n\n- [ ] task');

  assert.equal(didUpdate, true);
  assert.match(previewNode.innerHTML, /<h1>Live Draft<\/h1>/);
  assert.match(previewNode.innerHTML, /<input type="checkbox" disabled>/);
});

test('updateDocumentLivePreview is a no-op when preview is not mounted', () => {
  const workspace = {
    querySelector() {
      return null;
    },
  };

  assert.equal(updateDocumentLivePreview(workspace, '# Hidden'), false);
});
