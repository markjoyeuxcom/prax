// The HTTP transport every machine client builds on — the prax CLI and the
// skill scripts (cli/lib/apiClient.js) and the MCP server and in-app assistant
// (mcp/praxClient.js). The clients keep their own endpoint maps and response
// shapes; everything about HOW a request reaches Prax is decided once, here:
//
//   - discovery and pinning: an explicit URL, else PRAX_API_URL, else the
//     desktop app's saved loopback port, else the dev default
//     (server/instanceDiscovery.js). The first candidate that answers a
//     read-only /readyz probe is pinned for the life of the client, and every
//     request — above all a write — goes only there. There is no write
//     failover: silently landing the same write in a second workspace is worse
//     than an honest "not reachable" (QINV-02);
//   - base headers: the bearer token, the agent origin and id on agent writes,
//     and the caller's calendar day (server/localDay.js);
//   - timeouts: one deadline per request covers the whole exchange, body
//     included; requests that wait on a chat model (Ask, generation) get the
//     long bound;
//   - error classification: PraxUnavailableError (nothing usable came back:
//     unreachable, or timed out with `timedOut: true`) and PraxApiError (Prax
//     answered with an HTTP error; carries `status`);
//   - the retry-safety rule: a request is re-sent at most once, and only when
//     the caller says it is safe — `retry: true` for receipted operations (a
//     stable id or operation id makes a replay exact-once), `retry:
//     'connect-only'` for unreceipted idempotent setters, which may retry only
//     a failure that proves no request reached the server. A timeout is never
//     re-sent: Prax may still be processing it.
//
// It lives in server/ (beside instanceDiscovery.js) because server/ ships in
// every payload — desktop bundle, container, checkout — and the skill bundles
// inline it, so neither the MCP server nor the skills need cli/ to run.
import { detectAgent, resolveBaseUrls, sanitizeAgentId } from './instanceDiscovery.js';
import { localDayHeaders } from './localDay.js';

// The prax CLI and the skills: recall, search and context embed the query, and
// a local embedding model can take several seconds to load cold.
export const DEFAULT_TIMEOUT_MS = 30_000;
// The MCP server's ordinary requests: an agent is waiting in a tool call.
export const MCP_TIMEOUT_MS = 5000;
// Ask and the generations wait on a chat provider, which the server allows
// 120 s (and a local CLI provider queues behind other calls).
export const DEFAULT_LONG_TIMEOUT_MS = 180_000;
// The /readyz discovery probe only has to be answered.
export const PROBE_TIMEOUT_MS = 2000;

// The settings that change a bound, named in a timeout message.
const TIMEOUT_ENV = 'PRAX_TIMEOUT_MS';
const LONG_TIMEOUT_ENV = 'PRAX_MCP_TIMEOUT_MS';

// Failures that prove no request reached the server, so even an unreceipted
// write may be re-sent. ECONNRESET or a generic "fetch failed" can mean the
// response was lost after a successful commit.
const PROVEN_UNSENT_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];

// Nothing usable came back from Prax: it could not be reached (`kind:
// 'unreachable'`) or did not answer in time (`kind: 'timeout'`, `timedOut:
// true`, `timeoutMs`). For a write the outcome is unknown unless the message
// says otherwise.
export class PraxUnavailableError extends Error {
  constructor(message, { kind = 'unreachable', timeoutMs } = {}) {
    super(message);
    this.name = 'PraxUnavailableError';
    this.kind = kind;
    this.timedOut = kind === 'timeout';
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs;
  }
}

// Prax answered with an HTTP error status.
export class PraxApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PraxApiError';
    this.kind = 'http';
    this.status = status;
  }
}

// The bearer token: PRAX_API_TOKEN, then PRAX_TOKEN, then the pre-rename
// MOOMORA_API_TOKEN. An empty value counts as unset.
export function tokenFromEnv(env = process.env) {
  return env.PRAX_API_TOKEN || env.PRAX_TOKEN || env.MOOMORA_API_TOKEN || undefined;
}

// A millisecond setting, or undefined when unset. A value that is not a
// positive integer is a configuration error, reported rather than silently
// replaced by the default.
export function millisecondsFromEnv(name, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const ms = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(ms) || ms < 1) {
    throw new TypeError(`${name} must be a positive number of milliseconds (got "${raw}")`);
  }
  return ms;
}

export const timeoutFromEnv = (env = process.env) => millisecondsFromEnv(TIMEOUT_ENV, env);
export const longTimeoutFromEnv = (env = process.env) => millisecondsFromEnv(LONG_TIMEOUT_ENV, env);

export function formatDuration(ms) {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

export function isTimeoutError(err) {
  const name = err?.name || err?.cause?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export function isProvenUnsent(err) {
  return PROVEN_UNSENT_CODES.includes(err?.cause?.code || err?.code);
}

const WRITE_UNKNOWN = 'Write outcome unknown; reconcile before retrying. ';
const stripSlash = (url) => String(url).replace(/\/+$/, '');

function checkBound(name, value) {
  // AbortSignal.timeout throws a synchronous TypeError for an invalid delay;
  // say which setting is wrong instead of reporting "not reachable" later.
  if (!Number.isFinite(value) || value < 1) throw new TypeError(`${name} must be a positive finite number`);
}

export function createTransport({
  baseUrl, bases, env = process.env, portFile, readPortFile,
  token, agent, fetch, sendLocalDay = true,
  timeoutMs = DEFAULT_TIMEOUT_MS, longTimeoutMs, probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  checkBound('timeoutMs', timeoutMs);
  if (longTimeoutMs !== undefined) checkBound('longTimeoutMs', longTimeoutMs);
  checkBound('probeTimeoutMs', probeTimeoutMs);

  // Resolved per call, so a test (or a caller) that replaces globalThis.fetch
  // after creating the client is still honoured.
  const send = fetch || ((...args) => globalThis.fetch(...args));
  const bearer = token === undefined ? tokenFromEnv(env) : token;
  // An explicit `agent` wins (null: no agent, as for the in-app assistant);
  // otherwise PRAX_AGENT or the agent CLIs' shell markers.
  const agentId = agent === undefined ? detectAgent(env) : sanitizeAgentId(agent);

  // Candidates, most specific first. Re-read each discovery (the desktop app
  // may have started, and written its port, since the last one).
  const candidatesNow = () => (bases || resolveBaseUrls({ baseUrl, env, portFile, read: readPortFile }))
    .map(stripSlash);
  const candidates = candidatesNow();
  // One candidate needs no probe: it is the only place a request can go.
  let base = candidates.length === 1 ? candidates[0] : null;
  // One discovery for the whole client: every request that arrives before
  // the pin awaits the same probe, so concurrent first requests cannot each
  // discover a different instance, and nothing reassigns `base` once it is
  // set (a late probe completion cannot re-pin behind an in-flight write).
  let discovery = null;

  const unreachable = (where, err) => new PraxUnavailableError(
    `Prax not reachable at ${where} — is the app running? (${err?.message || 'no candidate answered'})`,
  );

  // Pin an instance with a read-only probe, trying candidates in order.
  async function probe() {
    const list = candidatesNow();
    let lastError;
    for (const candidate of list) {
      try {
        await send(`${candidate}/readyz`, { method: 'GET', signal: AbortSignal.timeout(probeTimeoutMs) });
        base ??= candidate;
        return;
      } catch (err) {
        lastError = err;
      }
    }
    // Nothing answered, so nothing was sent: no write outcome is in doubt.
    throw unreachable(list.join(' or '), lastError);
  }

  function ensurePinned() {
    if (base) return Promise.resolve();
    discovery ??= probe().finally(() => { discovery = null; });
    return discovery;
  }

  // `parse(response)` reads the body in the client's own shape; the transport
  // turns a stalled body into a timeout and a non-2xx status into a
  // PraxApiError carrying the body's `message`.
  async function request(method, path, {
    query, body, headers: extraHeaders, agentWrite = false, accept,
    retry = false, long = false, timeoutMs: requestTimeoutMs, parse,
  } = {}) {
    // The caller's calendar day: this process runs on the person's machine,
    // so completing a recurring task rolls forward from their today even
    // when Prax is a UTC container.
    const headers = sendLocalDay ? localDayHeaders() : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (agentWrite) headers['x-prax-origin'] = 'agent';
    if (accept) headers.accept = accept;
    if (extraHeaders) Object.assign(headers, extraHeaders);
    // Say which agent wrote, alongside the agent origin.
    if (headers['x-prax-origin'] === 'agent' && agentId) headers['x-prax-agent'] = agentId;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const bound = requestTimeoutMs ?? (long ? longTimeoutMs : timeoutMs);
    checkBound(long ? 'longTimeoutMs' : 'timeoutMs', bound);
    const write = !['GET', 'HEAD'].includes(method);

    await ensurePinned();
    // Only the pinned instance is ever contacted; a retry is a retry of the
    // SAME instance, never a search for another one.
    const target = base;
    const url = new URL(target + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const timedOut = (err) => new PraxUnavailableError(
      `${write ? WRITE_UNKNOWN : ''}Prax at ${target} did not answer within ${formatDuration(bound)} — the request may still be processing; it was not re-sent. Set ${long ? LONG_TIMEOUT_ENV : TIMEOUT_ENV} to wait longer. (${err.message})`,
      { kind: 'timeout', timeoutMs: bound },
    );

    // One deadline covers the whole exchange, retry and body included.
    const signal = AbortSignal.timeout(bound);
    const attempts = retry ? 2 : 1;
    let response; let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        // A non-native injected fetch may ignore `signal`, dropping the timeout.
        response = await send(url.toString(), { method, headers, body: payload, signal });
        break;
      } catch (err) {
        lastError = err;
        if (isTimeoutError(err)) break;
        if (retry === 'connect-only' && !isProvenUnsent(err)) break;
      }
    }
    if (!response) {
      if (isTimeoutError(lastError)) throw timedOut(lastError);
      const error = unreachable(target, lastError);
      if (write) error.message = `${WRITE_UNKNOWN}${error.message}`;
      throw error;
    }

    let parsed;
    try {
      parsed = await parse(response);
    } catch (err) {
      // The status line arrived but the body stalled past the deadline.
      if (isTimeoutError(err)) throw timedOut(err);
      throw err;
    }
    if (!response.ok) {
      throw new PraxApiError(response.status, (parsed && parsed.message) || `HTTP ${response.status}`);
    }
    return parsed;
  }

  return {
    request,
    // The pinned instance, or the first candidate before anything answered.
    get base() { return base ?? candidates[0]; },
    candidates,
    agent: agentId,
  };
}
