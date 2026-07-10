#!/usr/bin/env node
// NL prompt regression eval. Runs the pinned phrase→expected fixtures through
// the real capture / filter prompts against an ENV-configured chat backend and
// prints a per-case pass/fail table. Run it after ANY edit to the prompts in
// server/nlParse.js — the fixtures encode behavior validated against a real
// model, so a new failure is a prompt regression, not fixture drift.
//
//   CHAT_BACKEND=anthropic ANTHROPIC_API_KEY=sk-… npm run eval:nl
//   CHAT_BACKEND=ollama    CHAT_MODEL=llama3.1    npm run eval:nl
//
// Exits non-zero on any failure. Deliberately NOT part of `npm test` — it
// spends real model tokens (one small call per case) and needs a key.

import { loadConfig } from '../server/config.js';
import { createChatProvider } from '../server/chatProvider.js';
import { EVAL_DATE, GROUNDING, CAPTURE_CASES, FILTER_CASES } from '../tests/eval/nlFixtures.js';
import { runNlEval } from '../tests/eval/nlEval.js';

const provider = createChatProvider({ config: loadConfig() });
const chat = await provider.getChat().catch(() => null);
if (!chat) {
  console.error('\nNo chat backend configured — set CHAT_BACKEND (+ key/model) in the environment, e.g.');
  console.error('  CHAT_BACKEND=anthropic ANTHROPIC_API_KEY=sk-… npm run eval:nl\n');
  process.exit(2);
}
if (chat.backend === 'fake') {
  console.error('\nCHAT_BACKEND=fake cannot answer the fixtures (it echoes) — use a real backend.\n');
  process.exit(2);
}

console.log(`\nNL prompt eval · backend ${chat.backend} · model ${chat.model || '(default)'} · today pinned to ${EVAL_DATE}\n`);

const { results, passed, total } = await runNlEval(chat, {
  date: EVAL_DATE,
  grounding: GROUNDING,
  captureCases: CAPTURE_CASES,
  filterCases: FILTER_CASES,
});

for (const r of results) {
  console.log(`  ${r.pass ? '✓' : '✗'} [${r.kind}] ${r.name}`);
  console.log(`      "${r.text}"`);
  if (r.detail) console.log(`      → ${r.detail}`);
  for (const p of r.problems) console.log(`      FAIL: ${p}`);
}
console.log(`\n  ${passed}/${total} cases passed\n`);

if (passed !== total) process.exit(1);
