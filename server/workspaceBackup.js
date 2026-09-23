import { mkdtemp, chmod, rm, readFile } from 'node:fs/promises';
import { openSync, fsyncSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { finalSchemaVersion, validateSqliteBackup } from './sqliteBackup.js';
import { WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_VERSION } from './backupManifest.js';
import { readStarterContent } from './starterContent.js';

export function registerWorkspaceBackupRoutes(app) {
  let active = false;
  app.get('/api/workspace/backup', async (request, reply) => {
    if (!app.db?.snapshot) return reply.code(503).send({ message: 'Workspace backup requires the persistent Prax server.' });
    if (active) return reply.code(409).send({ message: 'A workspace backup is already being prepared. Retry when it finishes.' });
    active = true;
    let directory, archive, released = false, disconnected = false;
    const cleanup = async () => {
      if (released) return; released = true;
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      catch (error) { request.log.error({ err: error }, 'workspace backup cleanup failed'); }
      finally { active = false; }
    };
    reply.raw.once('close', () => {
      disconnected = true;
      // A snapshot in progress owns its files until it has finished writing.
      if (archive) { archive.destroy(); void cleanup(); }
    });
    try {
      directory = await mkdtemp(join(tmpdir(), 'prax-workspace-backup-'));
      await chmod(directory, 0o700);
      const path = join(directory, 'prax.db');
      await app.db.snapshot(path);
      await chmod(path, 0o600);
      const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      const proof = validateSqliteBackup(path);
      const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      // schema.finalMigration lets a restore refuse a backup from a newer Prax.
      const manifest = { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, praxVersion: packageInfo.version,
        schema: { finalMigration: finalSchemaVersion(path) },
        createdAt: new Date().toISOString(), database: { file: 'prax.db', sha256: proof.sha256, bytes: proof.bytes,
          integrityCheck: proof.integrityCheck, foreignKeyViolations: proof.foreignKeyViolations },
        includes: ['all committed SQLite tables', 'all projects and archived content', 'provider settings and saved credentials', 'bundled starter guides'],
        excludes: ['unsaved drafts', 'browser-only preferences and pending decisions', 'external files and environment configuration'] };
      const guide = await readFile(new URL('../public/starter-content/workspace-restore.md', import.meta.url), 'utf8');
      const starters = await readStarterContent();
      if (disconnected) { await cleanup(); return reply.hijack(); }
      archive = new ZipArchive({ zlib: { level: 6 } });
      archive.file(path, { name: 'prax.db', mode: 0o600 });
      archive.append(JSON.stringify(manifest, null, 2) + '\n', { name: 'manifest.json' });
      archive.append(guide, { name: 'RESTORE.md' });
      for (const starter of starters) archive.append(starter.body, { name: `starter-content/${starter.id}.md` });
      archive.once('end', () => { void cleanup(); });
      archive.once('close', () => { void cleanup(); });
      archive.once('error', error => { request.log.error({ err: error }, 'workspace backup stream failed'); void cleanup(); });
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="prax-workspace-${manifest.createdAt.slice(0, 10)}.zip"`);
      void archive.finalize().catch(error => archive.destroy(error));
      return reply.send(archive);
    } catch (error) {
      request.log.error({ err: error }, 'workspace backup failed');
      await cleanup();
      return reply.code(500).send({ message: 'Prax could not create a validated workspace backup. Nothing was changed.' });
    }
  });
}
