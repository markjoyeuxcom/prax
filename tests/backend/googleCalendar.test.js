import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_CALENDAR_SCOPE,
  buildGoogleAuthUrl,
  buildPkcePair,
  createGoogleCalendarClient,
  googleEventId,
  planCalendarSync,
  taskToGoogleEvent,
} from '../../server/googleCalendar.js';
import { isCalendarEligible } from '../../server/icsFeed.js';
import { buildApp } from '../../server/index.js';

const TASK = {
  id: '11111111-2222-4333-8444-555555555555',
  title: 'Rotate the TLS certs',
  description: 'Renew via certbot',
  status: 'planned',
  projectId: 'p1',
  dueDate: '2026-07-24',
  dueTime: null,
  deferredUntil: null,
  archivedAt: null,
};

test('googleEventId is the uuid hex without dashes (valid base32hex)', () => {
  assert.equal(googleEventId(TASK.id), '11111111222243338444555555555555');
  assert.throws(() => googleEventId('not-a-valid-*id*'), /cannot become a Google event id/);
});

test('buildGoogleAuthUrl carries the PKCE challenge, scope, and offline consent', () => {
  const { verifier, challenge } = buildPkcePair();
  assert.ok(verifier.length >= 43);
  const url = new URL(buildGoogleAuthUrl({
    clientId: 'cid', redirectUri: 'http://127.0.0.1:3000/cb', state: 's1', codeChallenge: challenge,
  }));
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('taskToGoogleEvent mirrors the ICS semantics: all-day vs timed wall-clock', () => {
  const allDay = taskToGoogleEvent(TASK, { timeZone: 'Europe/London' });
  assert.deepEqual(allDay.start, { date: '2026-07-24' });
  assert.deepEqual(allDay.end, { date: '2026-07-24' });
  assert.equal(allDay.id, googleEventId(TASK.id));
  assert.equal(allDay.summary, 'Rotate the TLS certs');

  const timed = taskToGoogleEvent({ ...TASK, dueTime: '09:30' }, { timeZone: 'Europe/London' });
  assert.deepEqual(timed.start, { dateTime: '2026-07-24T09:30:00', timeZone: 'Europe/London' });
});

test('planCalendarSync upserts eligible tasks and deletes stale events', () => {
  const other = { ...TASK, id: '99999999-9999-4999-8999-999999999999' };
  const plan = planCalendarSync([TASK], [googleEventId(TASK.id), googleEventId(other.id)]);
  assert.deepEqual(plan.upserts.map((t) => t.id), [TASK.id]);
  assert.deepEqual(plan.deletes, [googleEventId(other.id)]);
});

test('isCalendarEligible is the shared open-dated rule', () => {
  const now = new Date('2026-07-18T12:00:00Z');
  assert.equal(isCalendarEligible(TASK, now), true);
  assert.equal(isCalendarEligible({ ...TASK, status: 'completed' }, now), false);
  assert.equal(isCalendarEligible({ ...TASK, status: 'notes' }, now), false);
  assert.equal(isCalendarEligible({ ...TASK, dueDate: null }, now), false);
  assert.equal(isCalendarEligible({ ...TASK, deferredUntil: '2099-01-01T00:00:00Z' }, now), false);
  assert.equal(isCalendarEligible({ ...TASK, deferredUntil: '2020-01-01T00:00:00Z' }, now), true);
});

test('upsertEvent inserts, falls back to update on 409; deletes tolerate 404/410', async () => {
  const calls = [];
  const stub = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'at', expires_in: 3600 }) };
    }
    if (options.method === 'POST' && String(url).endsWith('/events')) {
      return { ok: false, status: 409, text: async () => '{}' };
    }
    if (options.method === 'PUT') {
      return { ok: true, status: 200, text: async () => '{}' };
    }
    if (options.method === 'DELETE') {
      return { ok: false, status: 410, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const client = createGoogleCalendarClient({ fetch: stub, clientId: 'c', clientSecret: 's', refreshToken: 'r' });
  await client.upsertEvent('cal1', taskToGoogleEvent(TASK, { timeZone: 'UTC' }));
  assert.ok(calls.some((c) => c.method === 'PUT'), '409 insert fell back to update');
  await client.deleteEvent('cal1', 'abcde12345');
  const tokenCalls = calls.filter((c) => c.url.includes('oauth2.googleapis.com/token')).length;
  assert.equal(tokenCalls, 1, 'the access token is cached across calls');
});

// ---- routes against a stubbed Google + real in-memory app ----

function googleStub({ eventIds = [] } = {}) {
  const log = [];
  const fetchStub = async (url, options = {}) => {
    const u = String(url);
    log.push({ url: u, method: options.method || 'GET', body: options.body });
    if (u.includes('oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(String(options.body));
      if (params.get('grant_type') === 'authorization_code') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ refresh_token: 'rt-1', access_token: 'at', expires_in: 3600 }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'at', expires_in: 3600 }) };
    }
    if (u.includes('/calendars') && (options.method || 'GET') === 'POST' && u.endsWith('/calendars')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'prax-cal-1' }) };
    }
    if (u.includes('/events?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: eventIds.map((id) => ({ id, status: 'confirmed' })) }) };
    }
    if ((options.method || 'GET') === 'POST' && u.endsWith('/events')) {
      return { ok: true, status: 200, text: async () => '{}' };
    }
    if (options.method === 'DELETE') {
      return { ok: true, status: 204, text: async () => '' };
    }
    if (u.includes('/calendars/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'prax-cal-1' }) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  fetchStub.log = log;
  return fetchStub;
}

async function integrationApp(fetchStub) {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config, googleFetch: fetchStub });
}

test('the full connect + sync + disconnect journey against a stubbed Google', async () => {
  const stub = googleStub({ eventIds: ['deadbeef00000000000000000000dead'] });
  const app = await integrationApp(stub);

  // Not configured: connect refuses.
  assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/connect' })).statusCode, 409);

  // Configure — secrets are stored but never echoed.
  const put = await app.inject({
    method: 'PUT', url: '/api/integrations/google-calendar/settings',
    payload: { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shhh' },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().configured, true);
  assert.equal(put.json().hasClientSecret, true);
  assert.equal(JSON.stringify(put.json()).includes('shhh'), false, 'the secret never leaves the server');

  // Connect: auth URL carries state; the callback exchanges the code and
  // creates the dedicated calendar.
  const connect = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/connect', headers: { host: '127.0.0.1:3000' } });
  assert.equal(connect.statusCode, 200);
  const authUrl = new URL(connect.json().authUrl);
  const state = authUrl.searchParams.get('state');
  assert.ok(state);
  const callback = await app.inject({ method: 'GET', url: `/api/integrations/google-calendar/callback?code=auth-code&state=${state}` });
  assert.equal(callback.statusCode, 200);
  assert.match(callback.body, /connected/i);

  // A replayed/forged state is refused.
  const replay = await app.inject({ method: 'GET', url: `/api/integrations/google-calendar/callback?code=x&state=${state}` });
  assert.equal(replay.statusCode, 400);

  const status = (await app.inject({ method: 'GET', url: '/api/integrations/google-calendar' })).json();
  assert.equal(status.connected, true);
  assert.equal(status.calendarId, 'prax-cal-1');

  // Seed one eligible and one ineligible task, then sync: the eligible task
  // is pushed and the stale stubbed event is removed.
  await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Dated', project: 'inbox', priority: 'medium', status: 'planned', dueDate: '2026-07-24' } });
  await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Undated', project: 'inbox', priority: 'medium', status: 'planned' } });
  const sync = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/sync' });
  assert.equal(sync.statusCode, 200);
  assert.equal(sync.json().pushed, 1);
  assert.equal(sync.json().removed, 1);
  assert.equal(sync.json().failed, 0);
  assert.equal(sync.json().degraded, undefined, 'a clean sync is not degraded');

  // Disconnect revokes and clears connection state but keeps the client id.
  const disconnect = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/disconnect' });
  assert.equal(disconnect.json().connected, false);
  assert.equal(disconnect.json().configured, true);
  assert.ok(stub.log.some((c) => c.url.includes('revoke')), 'the refresh token was revoked at Google');

  await app.close();
});

test('sync degrades (never 500s) when Google is unreachable', async () => {
  const unreachable = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const app = await integrationApp(unreachable);
  await app.inject({
    method: 'PUT', url: '/api/integrations/google-calendar/settings',
    payload: { clientId: 'cid', clientSecret: 's' },
  });
  // Force a connected-looking state without a real exchange.
  const settings = app.appSettingsRepository;
  const current = await settings.getSetting('google_calendar', {});
  await settings.putSetting('google_calendar', { ...current, refreshToken: 'rt' });

  const sync = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/sync' });
  assert.equal(sync.statusCode, 200);
  assert.equal(sync.json().degraded, true);
  assert.equal(sync.json().reason, 'unreachable');
  await app.close();
});
