export function buildGetSetting(key) {
  return { text: 'select value from app_settings where key = $1', values: [key] };
}

export function buildPutSetting(key, value) {
  return {
    text: `
      insert into app_settings (key, value, updated_at)
      values ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
    `,
    values: [key, JSON.stringify(value)],
  };
}

export function createAppSettingsRepository(db) {
  return {
    async getSetting(key, fallback = null) {
      const q = buildGetSetting(key);
      const result = await db.query(q.text, q.values);
      if (result.rows.length === 0) return fallback;
      // Settings are stored as JSON text (pg's jsonb auto-parsed on read;
      // SQLite hands back the text).
      try {
        return JSON.parse(result.rows[0].value);
      } catch {
        return fallback;
      }
    },
    async putSetting(key, value) {
      const q = buildPutSetting(key, value);
      await db.query(q.text, q.values);
      return value;
    },
  };
}
