// cli/lib/librarian.js — `prax used`, `prax doctor` and `prax telemetry`
// (spec: docs/superpowers/specs/2026-09-23-librarian-design.md). Pure of I/O:
// takes an injected client, returns structured results and text.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Exit codes for `prax doctor`: CI fails on 2 (a warning) as well as on 1
// (it could not run at all).
export const DOCTOR_EXIT = Object.freeze({ ok: 0, failed: 1, warn: 2 });

export function isDocumentId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Record that the agent acted on a memory. Validated before any request.
export async function markUsed(client, id) {
  if (!isDocumentId(id)) throw new Error('used requires a document uuid (the id recall prints).');
  return client.markUsed(id);
}

export function doctorExitCode(report) {
  if (!report || !Array.isArray(report.checks)) return DOCTOR_EXIT.failed;
  return report.checks.some((check) => check.level === 'warn') ? DOCTOR_EXIT.warn : DOCTOR_EXIT.ok;
}

const MARK = { ok: 'ok  ', info: 'info', warn: 'WARN' };

export function formatDoctor(report, { base } = {}) {
  if (!report) return 'No report.';
  const lines = [`Prax doctor${base ? ` — ${base}` : ''}: ${report.status === 'warn' ? 'warnings' : 'ok'}`];
  for (const check of report.checks || []) {
    lines.push(`  [${MARK[check.level] || check.level}] ${check.id}: ${check.message}`);
  }
  const clusters = (report.clusters?.clusters || []).filter((c) => c.status === 'new');
  if (clusters.length) {
    lines.push('', 'Duplicate clusters without a proposal (run the librarian in Library health):');
    for (const cluster of clusters.slice(0, 10)) {
      const titles = cluster.documents.map((d) => `"${d.title || d.id}"`).join(', ');
      const best = cluster.edges[0];
      lines.push(`  - ${titles}${best ? ` (${best.method} ${best.similarity})` : ''}`);
    }
  }
  const gaps = report.gaps?.items || [];
  if (gaps.length) {
    lines.push('', 'Knowledge gaps (asked, not answered):');
    for (const gap of gaps.slice(0, 10)) {
      lines.push(`  - "${gap.query}" — ${gap.reason === 'no-hits' ? 'no hits' : 'hits never used'}, asked ${gap.occurrences}×`);
    }
  }
  const prune = report.prune?.items || [];
  if (report.prune?.ready && prune.length) {
    lines.push('', `Never recalled in ${report.prune.coverageDays} days (prune candidates):`);
    for (const doc of prune.slice(0, 10)) lines.push(`  - ${doc.title} — ${doc.id}`);
  }
  if (report.telemetry) {
    const t = report.telemetry;
    lines.push('', `Telemetry: ${t.enabled ? 'on' : 'off'} · ${t.queries} queries · ${t.uses} used signals · kept ${t.retentionDays} days (local only; \`prax telemetry clear\` deletes it)`);
  }
  return lines.join('\n');
}

export function formatTelemetryStatus(stats) {
  if (!stats) return 'No telemetry status.';
  return [
    `Recall telemetry: ${stats.enabled ? 'on' : 'off (PRAX_RECALL_TELEMETRY=off)'}`,
    `  ${stats.queries} queries, ${stats.uses} used signals${stats.oldestAt ? `, since ${String(stats.oldestAt).slice(0, 10)}` : ''}`,
    `  kept ${stats.retentionDays} days, at most ${stats.maxQueryRows} queries and ${stats.maxUseRows} used signals`,
    '  local only: never sent anywhere or included in the portable export; in full workspace backups.',
  ].join('\n');
}
