import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';

test('loadConfig exposes embedding defaults', () => {
  const c = loadConfig({});
  assert.equal(c.embeddingBackend, 'none');
  assert.equal(c.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(c.embeddingModel, '');
});

test('loadConfig reads embedding env overrides', () => {
  const c = loadConfig({ EMBEDDING_BACKEND: 'ollama', EMBEDDING_MODEL: 'nomic-embed-text', OLLAMA_URL: 'http://host:9999' });
  assert.equal(c.embeddingBackend, 'ollama');
  assert.equal(c.embeddingModel, 'nomic-embed-text');
  assert.equal(c.ollamaUrl, 'http://host:9999');
});
