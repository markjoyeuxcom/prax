// Google Calendar push sync — pure helpers + a runtime provider mirroring the
// chat/embedder provider shape (settings live in app_settings, secrets are
// redacted on read, and every Google failure degrades instead of throwing
// past the route layer).
//
// Design decisions (the contract):
// - ONE-WAY push: tasks are the source of truth, the calendar is a
//   projection. Prax writes only to a dedicated calendar it created, using
//   the granular calendar.app.created scope, so disconnecting can never
//   strand edits in a calendar the user owns for other purposes.
// - Stable event IDs derived from task ids (uuid hex minus dashes — valid
//   Google base32hex), so every push is an idempotent upsert and a stale
//   task deletes exactly its own event. Same exact-once discipline as the
//   task routes.
// - No RRULE for recurring tasks — Prax spawns the next occurrence
//   server-side on completion (same reasoning as the ICS feed).
// - OAuth: authorization-code with PKCE on the loopback redirect (the
//   documented installed-app flow). The user supplies their OWN OAuth
//   client (Desktop type) — an open-source local app cannot ship a shared
//   client secret.
import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_CALENDAR_SETTINGS_KEY = 'google_calendar';
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const PRAX_CALENDAR_SUMMARY = 'Prax';

export class GoogleApiError extends Error {
  constructor(message, { status = null, reason = 'google-api-error' } = {}) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.reason = reason;
  }
}

// Google event IDs must be base32hex ([a-v0-9]), length 5-1024. A uuid's hex
// digits [0-9a-f] are a subset; only the dashes must go.
export function googleEventId(taskId) {
  const id = String(taskId || '').toLowerCase().replace(/-/g, '');
  if (!/^[a-v0-9]{5,1024}$/.test(id)) {
    throw new GoogleApiError(`task id cannot become a Google event id: ${taskId}`, { reason: 'bad-event-id' });
  }
  return id;
}

export function buildPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildGoogleAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set('access_type', 'offline');
  // Without consent Google omits the refresh token on re-authorization.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// Task -> Google event body, mirroring the ICS feed's semantics: date-only
// tasks are all-day events, timed tasks are floating wall-clock instants
// pinned to the SERVER's timezone (tasks store local wall-clock time).
export function taskToGoogleEvent(task, { timeZone } = {}) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const event = {
    id: googleEventId(task.id),
    summary: task.title || 'Untitled task',
    ...(task.description ? { description: task.description } : {}),
  };
  if (task.dueTime && /^\d{2}:\d{2}$/.test(task.dueTime)) {
    const start = `${task.dueDate}T${task.dueTime}:00`;
    event.start = { dateTime: start, timeZone: zone };
    event.end = { dateTime: start, timeZone: zone };
  } else {
    event.start = { date: task.dueDate };
    event.end = { date: task.dueDate };
  }
  return event;
}

// Pure diff for a full sync: eligible tasks are upserted; events with no
// eligible task behind them are deleted. Both sides key on the derived id.
export function planCalendarSync(tasks, existingEventIds) {
  const eligible = Array.isArray(tasks) ? tasks : [];
  const wanted = new Map(eligible.map((task) => [googleEventId(task.id), task]));
  const existing = new Set(Array.isArray(existingEventIds) ? existingEventIds : []);
  return {
    upserts: [...wanted.values()],
    deletes: [...existing].filter((id) => !wanted.has(id)),
  };
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function createGoogleCalendarClient({ fetch = globalThis.fetch, clientId, clientSecret, refreshToken } = {}) {
  let accessToken = null;
  let accessTokenExpiresAt = 0;

  async function token() {
    if (accessToken && Date.now() < accessTokenExpiresAt - 30_000) return accessToken;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    let response;
    try {
      response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new GoogleApiError(`Google is unreachable (${err.message})`, { reason: 'unreachable' });
    }
    const payload = await readJson(response);
    if (!response.ok || !payload?.access_token) {
      const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const reason = payload?.error === 'invalid_grant' ? 'token-revoked' : 'token-refresh-failed';
      throw new GoogleApiError(`Google token refresh failed: ${detail}`, { status: response.status, reason });
    }
    accessToken = payload.access_token;
    accessTokenExpiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000;
    return accessToken;
  }

  async function call(method, path, { body, tolerate = [] } = {}) {
    const bearer = await token();
    let response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new GoogleApiError(`Google is unreachable (${err.message})`, { reason: 'unreachable' });
    }
    if (tolerate.includes(response.status)) return { tolerated: response.status };
    const payload = await readJson(response);
    if (!response.ok) {
      const detail = payload?.error?.message || `HTTP ${response.status}`;
      throw new GoogleApiError(`Google Calendar API error: ${detail}`, { status: response.status, reason: 'api-error' });
    }
    return payload;
  }

  return {
    async ensurePraxCalendar(existingCalendarId) {
      if (existingCalendarId) {
        const probe = await call('GET', `/calendars/${encodeURIComponent(existingCalendarId)}`, { tolerate: [404, 410] });
        if (!probe?.tolerated) return existingCalendarId;
      }
      const created = await call('POST', '/calendars', { body: { summary: PRAX_CALENDAR_SUMMARY } });
      return created.id;
    },
    async listEventIds(calendarId) {
      const ids = [];
      let pageToken = null;
      do {
        const query = new URLSearchParams({ maxResults: '2500', fields: 'items(id,status),nextPageToken', showDeleted: 'false' });
        if (pageToken) query.set('pageToken', pageToken);
        const page = await call('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
        for (const item of page.items || []) {
          if (item.status !== 'cancelled') ids.push(item.id);
        }
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      return ids;
    },
    async upsertEvent(calendarId, event) {
      const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
      const inserted = await call('POST', base, { body: event, tolerate: [409] });
      if (inserted?.tolerated === 409) {
        await call('PUT', `${base}/${encodeURIComponent(event.id)}`, { body: event });
      }
    },
    async deleteEvent(calendarId, eventId) {
      await call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        tolerate: [404, 410],
      });
    },
  };
}

const SECRET_FIELDS = ['clientSecret', 'refreshToken'];

export function createGoogleCalendarProvider({ appSettingsRepository, fetch = globalThis.fetch } = {}) {
  async function getSettings() {
    if (!appSettingsRepository) return {};
    const stored = await appSettingsRepository.getSetting(GOOGLE_CALENDAR_SETTINGS_KEY, null).catch(() => null);
    return stored && typeof stored === 'object' ? stored : {};
  }

  async function putSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === null || next[key] === '') delete next[key];
    }
    await appSettingsRepository.putSetting(GOOGLE_CALENDAR_SETTINGS_KEY, next);
    return next;
  }

  return {
    getSettings,
    putSettings,
    // Secrets never leave the server; status reports only their presence.
    async status() {
      const settings = await getSettings();
      return {
        configured: Boolean(settings.clientId && settings.clientSecret),
        connected: Boolean(settings.refreshToken),
        calendarId: settings.calendarId || null,
        accountEmail: settings.accountEmail || null,
        lastSyncAt: settings.lastSyncAt || null,
        lastSyncSummary: settings.lastSyncSummary || null,
        hasClientSecret: Boolean(settings.clientSecret),
      };
    },
    async client() {
      const settings = await getSettings();
      if (!settings.clientId || !settings.clientSecret) {
        throw new GoogleApiError('Google Calendar is not configured', { reason: 'not-configured' });
      }
      if (!settings.refreshToken) {
        throw new GoogleApiError('Google Calendar is not connected', { reason: 'not-connected' });
      }
      return createGoogleCalendarClient({
        fetch,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        refreshToken: settings.refreshToken,
      });
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const settings = await getSettings();
      const body = new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
      let response;
      try {
        response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
      } catch (err) {
        throw new GoogleApiError(`Google is unreachable (${err.message})`, { reason: 'unreachable' });
      }
      const payload = await readJson(response);
      if (!response.ok || !payload?.refresh_token) {
        const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
        throw new GoogleApiError(`Google authorization failed: ${detail}`, { status: response.status, reason: 'auth-failed' });
      }
      return { refreshToken: payload.refresh_token };
    },
    async revoke() {
      const settings = await getSettings();
      if (settings.refreshToken) {
        // Best-effort: a failed revoke must not block the local disconnect.
        try {
          await fetch(GOOGLE_REVOKE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: settings.refreshToken }).toString(),
          });
        } catch { /* offline revoke — the local state still disconnects */ }
      }
      await putSettings({ refreshToken: null, calendarId: null, accountEmail: null, lastSyncAt: null, lastSyncSummary: null });
    },
    secretFields: SECRET_FIELDS,
  };
}
