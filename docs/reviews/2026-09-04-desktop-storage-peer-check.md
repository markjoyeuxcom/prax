# Desktop storage follow-up — Claude challenge of Codex C02

This was a focused peer check after both initial independent reports were complete. Codex asked Claude to look for a native storage bridge, stable origin, or other implementation detail that would invalidate C02. It is corroboration, not an independently discovered initial finding.

Parley Ask: `f74ca360-c41b-4545-a5ea-e1d01e8dce57`. Claude returned that no mitigating mechanism was found:

- `src-tauri/src/lib.rs:359` sets `PORT=0`. Main and capture windows use the resulting external localhost URL (`:850`, `:597`). The port lives in `ServerPhase::Ready`; no persisted or fixed port was found. The bundled splash/recovery page is a different origin and does not host these drafts.
- Cargo plugins, capabilities, invoke handlers and frontend native calls contain no storage plugin, custom stable-origin protocol, or bridge for frontend recovery/preferences.
- Document and task recovery, capture recovery, theme/preferences, pinned/collapsed state, saved Library/task views, active project and nudges use localStorage. Its port-sensitive origin changes with the sidecar URL.
- Server `app_settings` covers provider/calendar/shortcut settings, not these frontend records. No server mirror for those records was found.
- The backup documentation explicitly calls frontend storage origin-local. Existing fixed-port browser journeys do not test desktop relaunch across ports.

This corroborates the source analysis plus Codex's executed two-origin browser reproduction. Neither reviewer ran a packaged native restart; actual native recovery behavior remains a release verification gap. A fix should provide durable storage independent of the changing port while preserving the exact-origin security restrictions.
