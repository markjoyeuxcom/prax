# Google Calendar push sync

Prax can push your open dated tasks into a dedicated **"Prax" calendar** in
Google Calendar. It is a **one-way projection**: tasks are the source of
truth, the calendar mirrors them. Completing, rescheduling, snoozing, or
archiving a task updates or removes its event on the next sync; editing the
event in Google changes nothing in Prax and is overwritten by the next push.

What syncs — the same rule as the ICS feed and the in-app Calendar view:
open tasks with a due date. Completed, backlog, archived, and snoozed tasks
are excluded (a snoozed task's event is removed until it wakes). Tasks
without a time become all-day events; timed tasks use the Prax server's
local timezone. Recurring tasks carry no RRULE — Prax creates the next
occurrence as a real task on completion, and it syncs like any other.

## One-time setup: create your own OAuth client

Prax is a local-first app, so it cannot ship a shared Google client secret —
you create your own (free, ~5 minutes), exactly like other self-hosted tools:

1. Open the [Google Cloud Console](https://console.cloud.google.com/), create
   (or pick) a project.
2. **APIs & Services ▸ Library** — enable the **Google Calendar API**.
3. **APIs & Services ▸ OAuth consent screen** — External, fill the app name
   and your email, add your own Google account as a **test user**. No app
   verification is needed for personal use, but note Google's rule for
   External apps left in **Testing**: refresh tokens expire after seven days
   (the exemption for basic identity-only scopes does not apply, because Prax
   requests the Calendar scope). Expect to reconnect Prax to Google roughly
   weekly in Testing mode, or publish the consent screen to **Production**
   (Google may then require verification for the Calendar scope) to get
   long-lived tokens. See Google's
   [OAuth 2.0 token-expiration rules](https://developers.google.com/identity/protocols/oauth2).
4. **APIs & Services ▸ Credentials ▸ Create credentials ▸ OAuth client ID**
   — application type **Desktop app**. Desktop clients accept loopback
   redirects on any port, which is what Prax uses.
5. Copy the **Client ID** and **Client secret**.

## Connect

1. In Prax: **Settings ▸ Integrations ▸ Google Calendar** — paste the client
   ID and secret, **Save**. They are stored in the app database alongside
   the AI provider keys and are never echoed back by the API.
6. Click **Connect** — your browser opens Google's consent screen. The
   requested scope is `calendar.app.created`: Prax can only manage
   **calendars it created itself**, never your existing calendars.
7. After consenting you land on a local confirmation page; back in Prax the
   status flips to connected and the dedicated "Prax" calendar exists in
   your Google account (add it to your phone's calendar app from there).

## Sync

Once connected, sync is **live**: creating, editing, completing, archiving,
or restoring a task pushes the change to Google within a few seconds,
automatically. Big changes (imports, project replaces) run one full
reconcile instead of many per-event calls, and a background sweep re-runs
the reconcile every 15 minutes so anything a failed push missed heals
itself. The Integrations card shows the live-push status — last push time,
or the exact error if a push failed (the sweep retries it).

**Sync now** is still there as a manual full reconcile: it pushes every
eligible task and removes every stale event, and reports honestly — pushed /
removed counts, and any per-task failures — a partial failure is shown as
degraded, never as clean success. Google being unreachable degrades the
integration status; it never breaks or slows task operations.

**Disconnect** revokes the token at Google and clears the connection locally.
The "Prax" calendar is deliberately left in your Google account (delete it
there if you want it gone); reconnecting reuses it.

## Notes

- The refresh token, client secret, and sync state live in the `app_settings`
  table of your Prax database — include it in backups like everything else,
  and treat backup files as secret-bearing.
- The OAuth callback is served on whatever host/port Prax runs on. The
  desktop app persists its loopback port across launches, and the redirect
  is negotiated per connect anyway, so no fixed port has to be registered.
