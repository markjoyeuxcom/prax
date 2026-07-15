#!/usr/bin/env node

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { chromium } from '@playwright/test';

import { createQualityFixture, QUALITY_FIXTURE_PROFILES } from './create-quality-fixture.js';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/index.js';

export const PERFORMANCE_REPORT_FORMAT = 'prax.quality-performance';
export const PERFORMANCE_REPORT_VERSION = 1;
const DEFAULT_SAMPLES = 11;
const DEFAULT_WARMUPS = 3;

function rounded(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function percentile(samples, requestedPercentile) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('percentile requires samples');
  const p = Number(requestedPercentile);
  if (!Number.isFinite(p) || p <= 0 || p > 100) throw new Error('percentile must be greater than 0 and at most 100');
  const values = samples.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('performance samples must be finite non-negative numbers');
  }
  values.sort((a, b) => a - b);
  return values[Math.max(0, Math.ceil((p / 100) * values.length) - 1)];
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('sample set must not be empty');
  return {
    samplesMs: samples.map(rounded),
    minMs: rounded(Math.min(...samples)),
    p50Ms: rounded(percentile(samples, 50)),
    p95Ms: rounded(percentile(samples, 95)),
    maxMs: rounded(Math.max(...samples)),
  };
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return number;
}

export function parsePerformanceArgs(argv) {
  const options = { profile: 'large', samples: DEFAULT_SAMPLES, warmups: DEFAULT_WARMUPS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--keep') options.keepArtifacts = true;
    else if (['--profile', '--samples', '--warmups', '--output'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--profile') options.profile = value;
      else if (arg === '--samples') options.samples = positiveInteger(value, '--samples');
      else if (arg === '--warmups') options.warmups = positiveInteger(value, '--warmups', { allowZero: true });
      else options.output = resolve(value);
    } else {
      throw new Error(`Unknown performance option: ${arg}`);
    }
  }
  if (!QUALITY_FIXTURE_PROFILES[options.profile]) throw new Error(`Unknown quality fixture profile: ${options.profile}`);
  return options;
}

function validateSampleGroup(group, expectedSamples, label) {
  if (!group || typeof group !== 'object') throw new Error(`${label} measurement is missing`);
  if (!Array.isArray(group.samplesMs) || group.samplesMs.length !== expectedSamples) {
    throw new Error(`${label} must contain ${expectedSamples} samples`);
  }
  for (const key of ['minMs', 'p50Ms', 'p95Ms', 'maxMs']) {
    if (!Number.isFinite(group[key]) || group[key] < 0) throw new Error(`${label}.${key} is invalid`);
  }
  if (!(group.minMs <= group.p50Ms && group.p50Ms <= group.p95Ms && group.p95Ms <= group.maxMs)) {
    throw new Error(`${label} percentiles are out of order`);
  }
}

export function validatePerformanceReport(report) {
  if (report?.format !== PERFORMANCE_REPORT_FORMAT || report?.version !== PERFORMANCE_REPORT_VERSION) {
    throw new Error('performance report format/version is invalid');
  }
  if (report.activation !== 'candidate-baseline-only') throw new Error('performance activation state is invalid');
  const expectedSamples = positiveInteger(report.configuration?.samples, 'report samples');
  positiveInteger(report.configuration?.warmups, 'report warmups', { allowZero: true });
  for (const [name, group] of Object.entries(report.http || {})) {
    validateSampleGroup(group, expectedSamples, `http.${name}`);
  }
  for (const [name, group] of Object.entries(report.browser || {})) {
    validateSampleGroup(group, expectedSamples, `browser.${name}`);
  }
  if (Object.keys(report.http || {}).length === 0 || Object.keys(report.browser || {}).length === 0) {
    throw new Error('performance report requires HTTP and browser measurements');
  }
  for (const [key, value] of Object.entries(report.resources || {})) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`resources.${key} is invalid`);
  }
  return true;
}

async function measureRequest(url, assertion) {
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  assertion?.(body);
  return performance.now() - started;
}

async function collectHttpMeasurements(baseUrl, manifest, { warmups, samples }) {
  const sentinel = manifest.expected.sentinels;
  const definitions = {
    projects: {
      path: '/api/projects?status=all',
      assert: (body) => { if (!Array.isArray(body) || body.length < 5) throw new Error('project measurement returned incomplete data'); },
    },
    'tasks-all': {
      path: '/api/tasks?archived=all',
      assert: (body) => { if (!Array.isArray(body) || body.length !== manifest.expected.counts.tasks) throw new Error('task measurement returned incomplete data'); },
    },
    'tasks-search': {
      path: `/api/tasks?q=${encodeURIComponent(sentinel.unicodeTask.title)}`,
      assert: (body) => { if (!Array.isArray(body) || !body.some((task) => task.id === sentinel.unicodeTask.id)) throw new Error('task search missed its sentinel'); },
    },
    'library-all': {
      path: '/api/library/documents?archived=all',
      assert: (body) => { if (!Array.isArray(body) || body.length !== manifest.expected.counts.documents) throw new Error('Library measurement returned incomplete data'); },
    },
    'document-detail': {
      path: `/api/library/documents/${sentinel.runbook.id}`,
      assert: (body) => { if (body?.id !== sentinel.runbook.id) throw new Error('document detail missed its sentinel'); },
    },
  };
  const result = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const url = `${baseUrl}${definition.path}`;
    for (let index = 0; index < warmups; index += 1) await measureRequest(url, definition.assert);
    const values = [];
    for (let index = 0; index < samples; index += 1) values.push(await measureRequest(url, definition.assert));
    result[name] = summarizeSamples(values);
  }
  return result;
}

async function runBrowserJourney(page, manifest) {
  const started = performance.now();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="nav-library"]').first().waitFor({ state: 'visible' });
  const shellFeedback = performance.now() - started;
  await page.locator('.task-row').first().waitFor({ state: 'visible' });
  const taskCompletion = performance.now() - started;

  const captureStarted = performance.now();
  await page.locator('[data-action="open-capture"]').first().click();
  await page.getByRole('dialog', { name: 'Quick capture' }).waitFor({ state: 'visible' });
  const captureFeedback = performance.now() - captureStarted;
  await page.keyboard.press('Escape');

  const libraryStarted = performance.now();
  await page.locator('[data-action="nav-library"]').first().click();
  const runbookCard = page.locator('.doc-card', { hasText: manifest.expected.sentinels.runbook.title });
  await runbookCard.waitFor({ state: 'visible' });
  const libraryCompletion = performance.now() - libraryStarted;

  const editorStarted = performance.now();
  await runbookCard.click();
  await page.locator('[data-doc-title]').waitFor({ state: 'visible' });
  if (await page.locator('[data-doc-title]').inputValue() !== manifest.expected.sentinels.runbook.title) {
    throw new Error('browser editor journey opened the wrong document');
  }
  return {
    'shell-feedback': shellFeedback,
    'task-collection-completion': taskCompletion,
    'quick-capture-feedback': captureFeedback,
    'library-completion': libraryCompletion,
    'editor-completion': performance.now() - editorStarted,
  };
}

async function collectBrowserMeasurements(baseUrl, manifest, { warmups, samples }) {
  const browser = await chromium.launch();
  const version = browser.version();
  const page = await browser.newPage({ baseURL: baseUrl, reducedMotion: 'reduce' });
  const values = {};
  try {
    for (let index = 0; index < warmups + samples; index += 1) {
      const journey = await runBrowserJourney(page, manifest);
      if (index < warmups) continue;
      for (const [name, duration] of Object.entries(journey)) {
        (values[name] ||= []).push(duration);
      }
    }
  } finally {
    await browser.close();
  }
  return {
    version,
    measurements: Object.fromEntries(Object.entries(values).map(([name, durations]) => [name, summarizeSamples(durations)])),
  };
}

export async function measureQualityPerformance(options = {}) {
  const profile = options.profile || 'large';
  if (!QUALITY_FIXTURE_PROFILES[profile]) throw new Error(`Unknown quality fixture profile: ${profile}`);
  const samples = positiveInteger(options.samples ?? DEFAULT_SAMPLES, 'samples');
  const warmups = positiveInteger(options.warmups ?? DEFAULT_WARMUPS, 'warmups', { allowZero: true });
  const ownedWorkspace = !options.workspaceRoot;
  const workspaceRoot = options.workspaceRoot
    ? resolve(options.workspaceRoot)
    : mkdtempSync(join(tmpdir(), 'prax-quality-performance-'));
  const databaseFile = join(workspaceRoot, 'prax-performance.db');
  const rssBefore = process.memoryUsage().rss;
  const resourcesBefore = process.resourceUsage();
  let app;
  let fixture;
  let report;
  try {
    const fixtureStarted = performance.now();
    fixture = await createQualityFixture({ databaseFile, profile, force: true });
    const fixtureGenerationMs = performance.now() - fixtureStarted;

    const config = loadConfig({
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      PRAX_DB_FILE: databaseFile,
      EMBEDDING_BACKEND: 'none',
      CHAT_BACKEND: 'none',
    });
    const appStarted = performance.now();
    app = await buildApp({ config, logger: false });
    const address = await app.listen({ host: config.host, port: 0 });
    const appReadyMs = performance.now() - appStarted;
    const baseUrl = typeof address === 'string' ? address : `http://127.0.0.1:${address.port}`;

    const http = await collectHttpMeasurements(baseUrl, fixture.manifest, { warmups, samples });
    const browser = await collectBrowserMeasurements(baseUrl, fixture.manifest, { warmups, samples });
    const resourcesAfter = process.resourceUsage();
    report = {
      format: PERFORMANCE_REPORT_FORMAT,
      version: PERFORMANCE_REPORT_VERSION,
      activation: 'candidate-baseline-only',
      generatedAt: new Date().toISOString(),
      reference: {
        platform: process.platform,
        release: os.release(),
        architecture: process.arch,
        node: process.version,
        chromium: browser.version,
        cpuModel: os.cpus()[0]?.model || 'unknown',
        logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      fixture: {
        profile: fixture.manifest.profile,
        seed: fixture.manifest.seed,
        clock: fixture.manifest.clock,
        schemaVersion: fixture.manifest.schema.finalVersion,
        counts: fixture.manifest.expected.counts,
      },
      configuration: { warmups, samples },
      setupMs: { fixtureGeneration: rounded(fixtureGenerationMs), appReady: rounded(appReadyMs) },
      http,
      browser: browser.measurements,
      resources: {
        databaseBytes: statSync(databaseFile).size,
        nodeRssBeforeBytes: rssBefore,
        nodeRssAfterBytes: process.memoryUsage().rss,
        userCpuMicroseconds: resourcesAfter.userCPUTime - resourcesBefore.userCPUTime,
        systemCpuMicroseconds: resourcesAfter.systemCPUTime - resourcesBefore.systemCPUTime,
      },
      artifactsRetained: Boolean(options.keepArtifacts),
      ...(options.keepArtifacts ? { workspaceRoot } : {}),
    };
    validatePerformanceReport(report);
    return report;
  } finally {
    if (app) await app.close();
    if (ownedWorkspace && !options.keepArtifacts) rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const HELP = `Usage:
  npm run measure:performance -- [--profile large|ci] [--samples 11] [--warmups 3]

Options:
  --output <file>  Write the versioned JSON report to a file as well as stdout.
  --keep           Retain the owned temporary fixture and include its path in the report.

This command records a candidate baseline. It does not activate a numerical release budget.
`;

async function main() {
  const options = parsePerformanceArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const report = await measureQualityPerformance(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) writeFileSync(options.output, json, { mode: 0o600 });
  process.stdout.write(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
