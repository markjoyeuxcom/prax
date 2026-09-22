import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { GOOGLE_CALENDAR_SETTINGS_KEY, createGoogleCalendarProvider, googleEventId } from '../../server/googleCalendar.js';
import { createCalendarPusher } from '../../server/googleCalendarSync.js';

// 2026-09-22 review (ebc0b512): the Google Calendar connection lifecycle.
// A local, stateful Google transport: OAuth token/revoke endpoints plus a
// Calendar API that remembers calendars and events, so reconnects, disabled
// APIs and failing token refreshes behave as Google would. No network.
function googleFixture() {
  const state = {
    calendars: new Map(), nextCalendar: 1, calendarsCreated: 0, grants: 0,
    calendarApiEnabled: true, tokenRefreshFails: false, log: [],
  };
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });
  async function fetch(url, options = {}) {
    const u = new URL(String(url));
    const method = options.method || 'GET';
    state.log.push({ method, url: String(url) });
    if (u.host === 'oauth2.googleapis.com') {
      if (u.pathname === '/revoke') return reply(200, {});
      const params = new URLSearchParams(String(options.body));
      if (params.get('grant_type') === 'authorization_code') {
        state.grants += 1;
        return reply(200, { refresh_token: `rt-${state.grants}`, access_token: 'at', expires_in: 3600 });
      }
      if (state.tokenRefreshFails) return reply(400, { error: 'invalid_client', error_description: 'token refresh failed' });
      return reply(200, { access_token: 'at', expires_in: 3600 });
    }
    if (!state.calendarApiEnabled) {
      return reply(403, { error: { message: 'Google Calendar API has not been used in this project or it is disabled' } });
    }
    const path = u.pathname.replace(/^\/calendar\/v3/, '');
    if (method === 'POST' && path === '/calendars') {
      const id = `prax-cal-${state.nextCalendar++}`;
      state.calendars.set(id, new Set());
      state.calendarsCreated += 1;
      return reply(200, { id, summary: 'Prax' });
    }
    const match = path.match(/^\/calendars\/([^/]+)(?:\/events(?:\/([^/?]+))?)?$/);
    const calendar = match ? state.calendars.get(decodeURIComponent(match[1])) : null;
    if (!calendar) return reply(404, { error: { message: 'Not Found' } });
    if (!path.includes('/events')) return reply(200, { id: decodeURIComponent(match[1]) });
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;
    if (method === 'GET') return reply(200, { items: [...calendar].map((id) => ({ id, status: 'confirmed' })) });
    if (method === 'POST') {
      const event = JSON.parse(options.body);
      if (calendar.has(event.id)) return reply(409, { error: { message: 'duplicate' } });
      calendar.add(event.id);
      return reply(200, event);
    }
    if (method === 'PUT') { calendar.add(eventId); return reply(200, {}); }
    if (method === 'DELETE') return calendar.delete(eventId) ? reply(204) : reply(410, { error: { message: 'Gone' } });
    return reply(404, {});
  }
  return { fetch, state };
}

async function integrationApp(t, google) {
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  const app = await buildApp({ config, googleFetch: google.fetch, calendarPushDebounceMs: 1 });
  t.after(() => app.close());
  const put = await app.inject({
    method: 'PUT', url: '/api/integrations/google-calendar/settings', payload: { clientId: 'cid', clientSecret: 'secret' },
  });
  assert.equal(put.statusCode, 200);
  return app;
}

async function connect(app) {
  const start = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/connect', headers: { host: '127.0.0.1:3000' } });
  const state = new URL(start.json().authUrl).searchParams.get('state');
  return app.inject({ method: 'GET', url: `/api/integrations/google-calendar/callback?code=auth-code&state=${state}` });
}
const status = async (app) => (await app.inject({ method: 'GET', url: '/api/integrations/google-calendar' })).json();
const disconnect = (app) => app.inject({ method: 'POST', url: '/api/integrations/google-calendar/disconnect' });
const syncNow = async (app) => (await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/sync' })).json();

test('disconnect then connect reuses the existing Prax calendar', async t => {
  const google = googleFixture();
  const app = await integrationApp(t, google);
  assert.equal((await connect(app)).statusCode, 200);
  assert.equal((await status(app)).calendarId, 'prax-cal-1');

  const off = (await disconnect(app)).json();
  assert.equal(off.connected, false);
  assert.equal(off.calendarId, 'prax-cal-1', 'disconnect remembers the calendar it leaves in Google');

  const again = await connect(app);
  assert.equal(again.statusCode, 200, again.body);
  const after = await status(app);
  assert.equal(after.connected, true);
  assert.equal(after.calendarId, 'prax-cal-1');
  assert.equal(google.state.calendarsCreated, 1, 'reconnecting did not create a second "Prax" calendar');

  // A calendar deleted in Google is replaced, not written into blindly.
  await disconnect(app);
  google.state.calendars.delete('prax-cal-1');
  assert.equal((await connect(app)).statusCode, 200);
  assert.equal((await status(app)).calendarId, 'prax-cal-2');
});

test('the callback result and Settings status agree when the calendar cannot be created', async t => {
  const google = googleFixture();
  google.state.calendarApiEnabled = false;
  const app = await integrationApp(t, google);

  const failed = await connect(app);
  assert.equal(failed.statusCode, 502);
  assert.match(failed.body, /not connected/);
  const afterFailure = await status(app);
  assert.equal(afterFailure.connected, false, 'Settings does not claim the connection the page reported as failed');
  assert.equal(afterFailure.calendarId, null);

  google.state.calendarApiEnabled = true;
  const ok = await connect(app);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, /connected/);
  const connected = await status(app);
  assert.equal(connected.connected, true);
  assert.equal(connected.calendarId, 'prax-cal-1');

  // A failed RE-connect keeps the working connection and says so.
  google.state.calendarApiEnabled = false;
  const failedReconnect = await connect(app);
  assert.equal(failedReconnect.statusCode, 502);
  assert.match(failedReconnect.body, /kept its existing connection/);
  const kept = await status(app);
  assert.equal(kept.connected, true);
  assert.equal(kept.calendarId, 'prax-cal-1');
  const stored = await app.appSettingsRepository.getSetting(GOOGLE_CALENDAR_SETTINGS_KEY, {});
  assert.equal(stored.refreshToken, 'rt-2', 'the unverified new token was not saved over the working one');
});

test('stale push errors clear after a clean sync, a reconnect, and a disconnect', async t => {
  const google = googleFixture();
  const app = await integrationApp(t, google);
  assert.equal((await connect(app)).statusCode, 200);
  const dated = { title: 'Dated', project: 'inbox', priority: 'medium', status: 'planned', dueDate: '2026-10-01' };

  async function breakPush() {
    google.state.tokenRefreshFails = true;
    assert.equal((await app.inject({ method: 'POST', url: '/api/tasks', payload: dated })).statusCode, 201);
    await app.calendarPusher.flush();
    assert.match((await status(app)).lastPushError || '', /token refresh failed/);
    google.state.tokenRefreshFails = false;
  }

  await breakPush();
  const clean = await syncNow(app);
  assert.equal(clean.failed, 0);
  assert.equal(clean.degraded, undefined);
  assert.equal((await status(app)).lastPushError, null, 'a clean Sync now clears the stale push error');

  await breakPush();
  assert.equal((await connect(app)).statusCode, 200);
  assert.equal((await status(app)).lastPushError, null, 'a successful reconnect starts with a clean push status');

  await breakPush();
  const off = (await disconnect(app)).json();
  assert.equal(off.lastPushError, null, 'disconnect clears the push status');
  assert.equal(off.lastPushAt, null);
});

test('a concurrent revoke and push status write cannot bring the connection back', async () => {
  let stored = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt-1', calendarId: 'prax-cal-1' };
  let gate = null;
  const appSettingsRepository = {
    async getSetting() {
      const snapshot = JSON.parse(JSON.stringify(stored));
      if (gate) { const wait = gate; gate = null; await wait; }
      return snapshot;
    },
    async putSetting(_key, value) { stored = JSON.parse(JSON.stringify(value)); return value; },
  };
  const google = googleFixture();
  const provider = createGoogleCalendarProvider({ appSettingsRepository, fetch: google.fetch });

  let release;
  gate = new Promise((resolve) => { release = resolve; });
  // A push records its status; its settings read stalls mid-merge...
  const pushWrite = provider.putSettings({ lastPushError: 'rate limited' }, { onlyIfConnected: true });
  await new Promise((resolve) => setImmediate(resolve));
  // ...while the user disconnects.
  const revoke = provider.revoke();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([pushWrite, revoke]);

  assert.equal(stored.refreshToken, undefined, 'the revoked token is not written back');
  assert.equal(stored.lastPushError, undefined);
  assert.equal((await provider.status()).connected, false);
  assert.equal(stored.calendarId, 'prax-cal-1');

  // Once disconnected, a late push status write is dropped rather than recorded.
  await provider.putSettings({ lastPushError: 'late failure' }, { onlyIfConnected: true });
  assert.equal(stored.lastPushError, undefined);
});

test('manual Sync now runs in the pusher queue, so a change made mid-sync wins', async () => {
  const TASK = {
    id: '11111111-2222-4333-8444-555555555555', title: 'Due soon', status: 'planned', projectId: 'p1',
    dueDate: '2026-10-01', dueTime: null, deferredUntil: null, archivedAt: null,
  };
  const byId = new Map([[TASK.id, TASK]]);
  const calls = [];
  let upsertStarted;
  const started = new Promise((resolve) => { upsertStarted = resolve; });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const client = {
    async ensurePraxCalendar(existing) { return existing || 'cal-1'; },
    async listEventIds() { calls.push('list'); return []; },
    async upsertEvent(_calendarId, event) {
      calls.push(`upsert:${event.id}`);
      upsertStarted();
      await held;
    },
    async deleteEvent(_calendarId, eventId) { calls.push(`delete:${eventId}`); },
  };
  const settings = { calendarId: 'cal-1', refreshToken: 'rt' };
  const provider = {
    async client() { return client; },
    async getSettings() { return { ...settings }; },
    async putSettings(patch) { Object.assign(settings, patch); },
  };
  const tasksRepository = {
    async getTask(id) { return byId.get(id) || null; },
    async listTasks() { return [...byId.values()]; },
  };
  const pusher = createCalendarPusher({ provider, tasksRepository, debounceMs: 1 });

  const sync = pusher.syncNow();
  await started; // the full sync has read its snapshot and is pushing the task
  byId.set(TASK.id, { ...TASK, status: 'completed' });
  pusher.notifyTaskChanged([TASK.id]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['list', `upsert:${googleEventId(TASK.id)}`], 'the incremental push waits for the running sync');

  release();
  const result = await sync;
  assert.equal(result.pushed, 1);
  await pusher.flush();
  assert.deepEqual(calls, ['list', `upsert:${googleEventId(TASK.id)}`, `delete:${googleEventId(TASK.id)}`],
    'the completion is applied after the sync, so its event is not left re-created');
  pusher.stop();
});
