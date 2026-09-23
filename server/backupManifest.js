import { readFileSync } from 'node:fs';
import { SchemaTooNewError, knownMigrations } from './migrate.js';

// The workspace backup manifest (manifest.json in a full workspace ZIP) and
// the restore guard that reads it. A backup made by a newer Prax is refused:
// restoring it here would run older code on a schema this build does not know.

export const WORKSPACE_BACKUP_FORMAT = 'prax.workspace-backup';
export const WORKSPACE_BACKUP_VERSION = 1;

export function praxVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

// Orders MAJOR.MINOR.PATCH[-prerelease] versions; a prerelease sorts before
// its release (0.39.0-rc.1 < 0.39.0). Returns null when either is malformed.
export function compareVersions(a, b) {
  const parse = (value) => String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return Math.sign(difference);
  }
  if (left[4] === right[4]) return 0;
  if (!left[4]) return 1;
  if (!right[4]) return -1;
  return left[4].localeCompare(right[4], 'en', { numeric: true }) < 0 ? -1 : 1;
}

// Refuses a manifest this build cannot restore: another format, a newer
// manifest version, a newer Prax, or a schema with migrations it does not
// know. The database file itself is checked again by the restore
// (assertRestorableSchema), so an edited or missing manifest cannot bypass it.
export function assertManifestRestorable(manifest, {
  currentVersion = praxVersion(),
  knownVersions = knownMigrations(),
} = {}) {
  if (!manifest || typeof manifest !== 'object' || manifest.format !== WORKSPACE_BACKUP_FORMAT) {
    throw new Error(`manifest.json is not a Prax workspace backup manifest (format ${WORKSPACE_BACKUP_FORMAT}). No restore was performed.`);
  }
  if (!Number.isInteger(manifest.version) || manifest.version > WORKSPACE_BACKUP_VERSION) {
    throw new Error(`This backup's manifest version ${manifest.version} is newer than this Prax supports (${WORKSPACE_BACKUP_VERSION}). Restore it with the Prax version that made it (${manifest.praxVersion || 'unknown'}) or newer. No restore was performed.`);
  }
  if (manifest.praxVersion !== undefined) {
    const order = compareVersions(manifest.praxVersion, currentVersion);
    if (order === null) {
      throw new Error(`manifest.json records an unreadable praxVersion (${manifest.praxVersion}). No restore was performed.`);
    }
    if (order > 0) {
      throw new Error(`This backup was made by Prax ${manifest.praxVersion}, which is newer than this Prax (${currentVersion}). `
        + `Restore it with Prax ${manifest.praxVersion} or newer; older code on a newer schema can lose data. No restore was performed.`);
    }
  }
  const finalMigration = manifest.schema?.finalMigration;
  if (finalMigration && !knownVersions.includes(finalMigration)) {
    throw new SchemaTooNewError([finalMigration], { finalKnown: knownVersions.at(-1), subject: 'This backup' });
  }
}
