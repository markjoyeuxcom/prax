// Google Calendar integration routes. Like every AI-adjacent surface: the
// Google path NEVER 500s — failures come back as 200 { degraded, reason } so
// the UI shows an honest integration status instead of a crash.
import { randomBytes } from 'node:crypto';
import { createTasksRepository } from './tasksRepository.js';
import {
  GoogleApiError,
  buildGoogleAuthUrl,
  buildPkcePair,
  createGoogleCalendarProvider,
} from './googleCalendar.js';
import { createCalendarPusher } from './googleCalendarSync.js';

const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 16;

function degradedFrom(err) {
  if (err instanceof GoogleApiError) return { degraded: true, reason: err.reason, message: err.message };
  return { degraded: true, reason: 'google-api-error', message: err?.message || 'Google Calendar failed' };
}

export async function registerGoogleCalendarRoutes(app, options = {}) {
  const provider = options.googleCalendarProvider
    || createGoogleCalendarProvider({ appSettingsRepository: options.appSettingsRepository || app.appSettingsRepository, fetch: options.googleFetch });
  const tasksRepository = options.tasksRepository || app.tasksRepository || createTasksRepository(app.db);

  // Incremental push (Phase 2): task routes notify this after mutations; the
  // sweep repairs anything a failed or missed push left behind.
  const pusher = createCalendarPusher({
    provider,
    tasksRepository,
    ...(options.calendarPushDebounceMs !== undefined ? { debounceMs: options.calendarPushDebounceMs } : {}),
  });
  app.decorate('calendarPusher', pusher);
  pusher.startSweep();
  app.addHook('onClose', async () => pusher.stop());

  // Pending OAuth states live in memory only: single-user local app, short
  // TTL, and a restart mid-consent just means clicking Connect again.
  const pendingStates = new Map();
  function prunePendingStates() {
    const now = Date.now();
    for (const [state, entry] of pendingStates) {
      if (entry.createdAt + CONNECT_STATE_TTL_MS < now) pendingStates.delete(state);
    }
  }

  app.get('/api/integrations/google-calendar', async () => provider.status());

  app.put('/api/integrations/google-calendar/settings', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const patch = {};
    for (const field of ['clientId', 'clientSecret']) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string') { reply.code(400); return { message: `${field} must be a string` }; }
        patch[field] = body[field].trim();
      }
    }
    if (Object.keys(patch).length === 0) { reply.code(400); return { message: 'no settings provided' }; }
    await provider.putSettings(patch);
    return provider.status();
  });

  app.post('/api/integrations/google-calendar/connect', async (request, reply) => {
    const settings = await provider.getSettings();
    if (!settings.clientId || !settings.clientSecret) {
      reply.code(409);
      return { message: 'Set the Google OAuth client id and secret first.' };
    }
    prunePendingStates();
    // Bounded: repeated Connect clicks evict the oldest consent (Map order is insertion order).
    while (pendingStates.size >= MAX_PENDING_STATES) pendingStates.delete(pendingStates.keys().next().value);
    const state = randomBytes(24).toString('base64url');
    const { verifier, challenge } = buildPkcePair();
    // The redirect must come back to THIS server instance — build it from the
    // request's own host (Desktop-type OAuth clients accept any loopback port).
    // Google only accepts http redirects to a loopback address for this
    // client type, so Connect works when the browser reaches Prax on
    // 127.0.0.1/localhost (see docs/google-calendar.md for network installs).
    const redirectUri = `http://${request.headers.host}/api/integrations/google-calendar/callback`;
    pendingStates.set(state, { verifier, redirectUri, createdAt: Date.now() });
    return {
      authUrl: buildGoogleAuthUrl({
        clientId: settings.clientId, redirectUri, state, codeChallenge: challenge,
      }),
    };
  });

  app.get('/api/integrations/google-calendar/callback', async (request, reply) => {
    const { code, state, error } = request.query;
    const pending = state ? pendingStates.get(state) : null;
    if (pending) pendingStates.delete(state);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    const escapeHtml = (text) => String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const page = (title, detail) => `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
      + `<body style="font-family: system-ui; max-width: 32rem; margin: 4rem auto;">`
      + `<h1 style="font-size:1.2rem;">${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body>`;
    if (error) return page('Google Calendar not connected', `Google reported: ${String(error)}. You can close this tab and try again from Prax.`);
    if (!code || !pending) {
      reply.code(400);
      return page('Google Calendar not connected', 'The sign-in link expired or was already used. Close this tab and click Connect again in Prax Settings.');
    }
    try {
      const { refreshToken } = await provider.exchangeCode({
        code: String(code), redirectUri: pending.redirectUri, codeVerifier: pending.verifier,
      });
      // Find (or create) the dedicated calendar with the NEW token before
      // saving it, while the user is watching: a connect that cannot reach
      // the Calendar API says so here, and Settings does not claim a
      // connection this page reports as failed. A calendar kept from an
      // earlier connection is probed and reused, never duplicated.
      const client = await provider.client({ refreshToken });
      const settings = await provider.getSettings();
      const calendarId = await client.ensurePraxCalendar(settings.calendarId || null);
      // A fresh connection starts with a clean push status.
      await provider.putSettings({ refreshToken, calendarId, lastPushAt: null, lastPushError: null });
      return page('Google Calendar connected', 'Prax is using its dedicated "Prax" calendar. Close this tab and return to Prax — Settings now offers Sync now.');
    } catch (err) {
      reply.code(502);
      // The new token was not saved. A connection made earlier stays as it
      // was (revoking the new token would revoke that grant too).
      const stillConnected = Boolean((await provider.getSettings()).refreshToken);
      return stillConnected
        ? page('Google Calendar not reconnected', `${degradedFrom(err).message}. Prax kept its existing connection. Close this tab and try again from Prax Settings.`)
        : page('Google Calendar not connected', `${degradedFrom(err).message}. Close this tab and try again from Prax Settings.`);
    }
  });

  app.post('/api/integrations/google-calendar/sync', async () => {
    try {
      // The full sync runs inside the pusher's serial queue, never beside an
      // incremental push: a task changed mid-sync is pushed after it, so the
      // sync's older snapshot cannot re-create a just-removed event.
      const result = await pusher.syncNow();
      // Partial failure is reported as such — never as clean success.
      return {
        pushed: result.pushed,
        removed: result.removed,
        failed: result.failed,
        failures: result.failures.slice(0, 10),
        summary: result.summary,
        ...(result.failed ? { degraded: true, reason: 'partial-failure' } : {}),
      };
    } catch (err) {
      return degradedFrom(err);
    }
  });

  app.post('/api/integrations/google-calendar/disconnect', async () => {
    await provider.revoke();
    // The dedicated calendar is left in Google deliberately: deleting user
    // data on disconnect is ruder than leaving an empty calendar to remove.
    return provider.status();
  });
}
