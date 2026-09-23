import { AsyncLocalStorage } from 'node:async_hooks';
import { createPraxClient } from '../../mcp/praxClient.js';

// Headers every in-process call made while serving one assistant request
// inherits — the requester's local day (server/localDay.js), so an approved
// completion of a recurring task rolls forward from the user's today, not the
// server clock's. Scoped per request: concurrent chats never see each other's.
const forwarded = new AsyncLocalStorage();

export function withForwardedHeaders(headers, work) {
  return forwarded.run(headers, work);
}

// A praxClient that talks to the app IN-PROCESS via Fastify's `inject` instead of
// over the network. This lets the built-in assistant reuse the exact same tool
// tree the MCP server exposes to external agents (mcp/tools/*), routed through
// the real HTTP handlers — so validation, project resolution, activity logging,
// and the trust model (agent writes → unverified) all behave identically, with
// no duplicated logic and no loopback socket.
export function createInjectClient(app) {
  const injectFetch = async (urlString, init = {}) => {
    const url = new URL(urlString);
    const res = await app.inject({
      method: init.method || 'GET',
      url: url.pathname + url.search,
      headers: { ...forwarded.getStore(), ...init.headers },
      // praxClient has already JSON.stringify'd the body; pass it through as-is.
      payload: init.body,
    });
    // Adapt LightMyRequest's response to the minimal fetch surface praxClient
    // uses (it checks `.ok`, `.status`, and `.text()`).
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => res.payload };
  };

  // baseUrl is a placeholder — only the path/query survive into inject. The
  // large timeouts are inert (injectFetch ignores the abort signal). No agent
  // id and no local day of its own: the server's environment and clock say
  // nothing about who is asking or what their today is (the forwarded headers do).
  return createPraxClient({
    baseUrl: 'http://prax.internal', fetch: injectFetch, timeoutMs: 60_000, longTimeoutMs: 60_000, agent: null,
    sendLocalDay: false,
    // Its searches are recorded as the assistant's, not an external MCP agent's.
    querySource: 'assistant',
  });
}
