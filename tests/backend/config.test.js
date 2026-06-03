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
  // Non-numeric garbage must fall back to the default, not become NaN (which
  // would silently make every semantic search return zero results).
  assert.equal(loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: 'abc' }).embeddingSearchMinSimilarity, 0.45);
  assert.equal(loadConfig({ EMBEDDING_SEARCH_TOP_DROP: 'NaN' }).embeddingSearchTopDrop, 0.20);
});

test('openai + query-prefix config defaults and overrides', () => {
  const d = loadConfig({});
  assert.equal(d.openaiBaseUrl, 'https://api.openai.com/v1');
  assert.equal(d.openaiApiKey, '');
  assert.equal(d.embeddingQueryPrefix, '');
  const o = loadConfig({ OPENAI_BASE_URL: 'http://x/v1', OPENAI_API_KEY: 'sk-1', EMBEDDING_QUERY_PREFIX: 'search_query: ' });
  assert.equal(o.openaiBaseUrl, 'http://x/v1');
  assert.equal(o.openaiApiKey, 'sk-1');
  assert.equal(o.embeddingQueryPrefix, 'search_query: ');
});
