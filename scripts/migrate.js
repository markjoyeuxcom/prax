import { loadConfig } from '../server/config.js';
import { createDb } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const db = createDb(config.databaseUrl);
try {
  await runMigrations(db, { logger: { info: (m) => console.log(m), error: (m) => console.error(m) } });
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
