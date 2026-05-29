import pg from 'pg';

const { Pool } = pg;

export function createDb(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    query: (text, params = []) => pool.query(text, params),
    connect: () => pool.connect(), // dedicated client; caller MUST release()
    async checkReady() {
      await pool.query('select 1');
      return true;
    },
    close: () => pool.end(),
  };
}
