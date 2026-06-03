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

test('embedding search thresholds default and override', () => {
  const d = loadConfig({});
  assert.equal(d.embeddingSearchMinSimilarity, 0.45);
  assert.equal(d.embeddingSearchTopDrop, 0.20);
  const o = loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: '0.6', EMBEDDING_SEARCH_TOP_DROP: '0.1' });
  assert.equal(o.embeddingSearchMinSimilarity, 0.6);
  assert.equal(o.embeddingSearchTopDrop, 0.1);
  assert.equal(loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: '' }).embeddingSearchMinSimilarity, 0.45);
});
