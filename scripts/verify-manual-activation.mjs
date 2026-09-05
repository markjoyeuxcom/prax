#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANUAL_ACTIVATION_FORMAT = 'prax.manual-activation';
export const MANUAL_ACTIVATION_VERSION = 1;
export const HUMAN_ATTESTATION = 'I performed these checks on the stated real environment and recorded the results honestly.';

export const MANUAL_JOURNEYS = Object.freeze({
  'shell-navigation': 'Reach the major surfaces and identify current location without pointer-only or visual-only cues.',
  'task-lifecycle': 'Capture, organise, edit, schedule, complete, and undo a task with truthful feedback.',
  'library-editor-trust': 'Find owned knowledge, understand trust, edit exact content, and observe its saved state.',
  'runbook-operation': 'Start, operate, interrupt/resume, finish, and inspect a run chronicle.',
  'import-export-native-dialog': 'Choose scope/ownership and exercise save/cancel without losing source data.',
  'settings-provider-status': 'Understand active security/provider state and operate Settings without hidden controls.',
  'failure-recovery-comprehension': 'Recognise a failed or uncertain outcome and choose the safe recovery action.',
  'touch-orientation': 'Operate touch-only in portrait and landscape without hover or precision-pointer help.',
  'native-install-persist-restart': 'Install the release artifact, persist across two launches, and exercise restart/recovery.',
});

export const LANE_JOURNEYS = Object.freeze({
  'screen-reader': [
    'shell-navigation', 'task-lifecycle', 'library-editor-trust', 'runbook-operation',
    'import-export-native-dialog', 'settings-provider-status', 'failure-recovery-comprehension',
  ],
  cognitive: [
    'shell-navigation', 'task-lifecycle', 'library-editor-trust', 'runbook-operation',
    'import-export-native-dialog', 'settings-provider-status', 'failure-recovery-comprehension',
  ],
  'physical-touch': [
    'shell-navigation', 'task-lifecycle', 'library-editor-trust', 'runbook-operation',
    'import-export-native-dialog', 'settings-provider-status', 'touch-orientation',
  ],
  'native-platform': [
    'shell-navigation', 'task-lifecycle', 'library-editor-trust', 'runbook-operation',
    'import-export-native-dialog', 'settings-provider-status', 'failure-recovery-comprehension',
    'native-install-persist-restart',
  ],
});

export const REQUIRED_MANUAL_MATRIX = Object.freeze([
  { lane: 'screen-reader', platformFamily: 'macos', assistiveTechnology: 'VoiceOver' },
  { lane: 'screen-reader', platformFamily: 'windows', assistiveTechnology: 'NVDA' },
  { lane: 'screen-reader', platformFamily: 'linux', assistiveTechnology: 'Orca' },
  { lane: 'cognitive', independentReviewer: true },
  { lane: 'physical-touch', platformFamily: 'ios' },
  { lane: 'physical-touch', platformFamily: 'android' },
  { lane: 'native-platform', platformTarget: 'macos-arm64' },
  { lane: 'native-platform', platformTarget: 'ubuntu-x64' },
  { lane: 'native-platform', platformTarget: 'ubuntu-arm64' },
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim() || /^<.*>$/.test(value.trim())) {
    throw new Error(`${label} must be completed by the human operator`);
  }
  return value.trim();
}

function isoDate(value, label) {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date/time`);
  return text;
}

function validateJourney(journey, index) {
  const prefix = `journeys[${index}]`;
  const id = requiredString(journey?.id, `${prefix}.id`);
  if (!MANUAL_JOURNEYS[id]) throw new Error(`${prefix}.id is unknown: ${id}`);
  if (!['pass', 'fail', 'blocked'].includes(journey.result)) {
    throw new Error(`${prefix}.result must be pass, fail, or blocked`);
  }
  requiredString(journey.notes, `${prefix}.notes`);
  if (!Array.isArray(journey.issues)) throw new Error(`${prefix}.issues must be an array`);
  if (journey.result !== 'pass' && journey.issues.length === 0) {
    throw new Error(`${prefix} must link an issue when ${journey.result}`);
  }
  journey.issues.forEach((issue, issueIndex) => requiredString(issue, `${prefix}.issues[${issueIndex}]`));
  if (journey.artifacts !== undefined) {
    if (!Array.isArray(journey.artifacts)) throw new Error(`${prefix}.artifacts must be an array`);
    journey.artifacts.forEach((artifact, artifactIndex) => requiredString(artifact, `${prefix}.artifacts[${artifactIndex}]`));
  }
  return id;
}

export function validateManualActivationRecord(record, { requirePass = false } = {}) {
  if (record?.format !== MANUAL_ACTIVATION_FORMAT || record?.version !== MANUAL_ACTIVATION_VERSION) {
    throw new Error('manual activation format/version is invalid');
  }
  const lane = record.environment?.lane;
  const requiredJourneys = LANE_JOURNEYS[lane];
  if (!requiredJourneys) throw new Error('environment.lane is invalid');
  requiredString(record.candidate?.revision, 'candidate.revision');
  requiredString(record.candidate?.artifactOrServer, 'candidate.artifactOrServer');
  isoDate(record.executedAt, 'executedAt');
  requiredString(record.operator?.nameOrHandle, 'operator.nameOrHandle');
  requiredString(record.operator?.role, 'operator.role');
  if (record.operator?.human !== true) throw new Error('operator.human must be true');
  if (lane === 'cognitive' && record.operator?.independentOfImplementation !== true) {
    throw new Error('cognitive evidence requires an independent reviewer');
  }
  requiredString(record.environment?.platformFamily, 'environment.platformFamily');
  requiredString(record.environment?.platformVersion, 'environment.platformVersion');
  requiredString(record.environment?.device, 'environment.device');
  requiredString(record.environment?.browserOrArtifact, 'environment.browserOrArtifact');
  if (lane === 'screen-reader') {
    requiredString(record.environment?.assistiveTechnology?.name, 'environment.assistiveTechnology.name');
    requiredString(record.environment?.assistiveTechnology?.version, 'environment.assistiveTechnology.version');
  }
  if (lane === 'physical-touch' && record.environment?.realHardware !== true) {
    throw new Error('physical-touch evidence requires realHardware true');
  }
  if (lane === 'native-platform') requiredString(record.environment?.platformTarget, 'environment.platformTarget');
  if (!Array.isArray(record.journeys)) throw new Error('journeys must be an array');
  const ids = record.journeys.map(validateJourney);
  if (new Set(ids).size !== ids.length) throw new Error('journey ids must be unique');
  const missing = requiredJourneys.filter((id) => !ids.includes(id));
  const unexpected = ids.filter((id) => !requiredJourneys.includes(id));
  if (missing.length) throw new Error(`missing required journeys: ${missing.join(', ')}`);
  if (unexpected.length) throw new Error(`unexpected journeys for ${lane}: ${unexpected.join(', ')}`);
  requiredString(record.attestation?.attestedBy, 'attestation.attestedBy');
  isoDate(record.attestation?.attestedAt, 'attestation.attestedAt');
  if (record.attestation?.statement !== HUMAN_ATTESTATION) throw new Error('human attestation statement is invalid');
  const passed = record.journeys.every((journey) => journey.result === 'pass');
  if (requirePass && !passed) throw new Error('manual activation record contains failed or blocked journeys');
  return { lane, passed, journeyCount: record.journeys.length };
}

function matchesMatrix(record, requirement) {
  if (record.environment.lane !== requirement.lane) return false;
  if (requirement.platformFamily && record.environment.platformFamily !== requirement.platformFamily) return false;
  if (requirement.platformTarget && record.environment.platformTarget !== requirement.platformTarget) return false;
  if (requirement.assistiveTechnology
      && record.environment.assistiveTechnology?.name !== requirement.assistiveTechnology) return false;
  if (requirement.independentReviewer && record.operator.independentOfImplementation !== true) return false;
  return true;
}

export function validateManualActivationMatrix(records, { requirePass = true } = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('manual activation matrix requires records');
  const summaries = records.map((record) => validateManualActivationRecord(record, { requirePass }));
  const missing = REQUIRED_MANUAL_MATRIX.filter((requirement) => !records.some((record) => matchesMatrix(record, requirement)));
  if (missing.length) {
    const labels = missing.map((item) => [item.lane, item.platformFamily, item.platformTarget, item.assistiveTechnology]
      .filter(Boolean).join('/'));
    throw new Error(`manual activation matrix is incomplete: ${labels.join(', ')}`);
  }
  return { recordCount: records.length, passed: summaries.every((summary) => summary.passed) };
}

function parseArgs(argv) {
  const options = { inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--matrix') options.matrix = true;
    else if (arg === '--require-pass') options.requirePass = true;
    else if (arg === '--input') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--input requires a file');
      options.inputs.push(resolve(value));
      index += 1;
    } else throw new Error(`Unknown manual activation option: ${arg}`);
  }
  return options;
}

const HELP = `Usage:
  npm run verify:manual-activation -- --input <record.json> [--input <record.json> ...]
                                      [--matrix] [--require-pass]

Validation never performs or invents a human drill. --matrix requires every supported evidence
lane/platform, and --require-pass rejects honest failed or blocked journey results.
`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(HELP);
  if (!options.inputs.length) throw new Error('at least one --input file is required');
  const records = options.inputs.map((input) => JSON.parse(readFileSync(input, 'utf8')));
  const result = options.matrix
    ? validateManualActivationMatrix(records, { requirePass: options.requirePass })
    : records.map((record) => validateManualActivationRecord(record, { requirePass: options.requirePass }));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
