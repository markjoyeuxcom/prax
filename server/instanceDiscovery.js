// Finding the running Prax and naming the calling agent — ONE implementation
// shared by every machine client: the prax CLI and skill scripts
// (cli/lib/apiClient.js re-exports it) and the MCP server (mcp/praxClient.js).
// It lives beside server/repoUrl.js for the same reason: server/ ships in every
// payload (desktop bundle, container, checkout), so the MCP server needs no
// cli/ to start, and the clients cannot drift apart on where the app is.
import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
// Tauri bundle identifier — the desktop app's app-data directory is named after it.
const DESKTOP_IDENTIFIER = 'com.moomora.prax';
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function sanitizeAgentId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return AGENT_ID_RE.test(id) ? id : null;
}

// Which agent CLI is running this process. An explicit PRAX_AGENT wins; then
// the environment markers the CLIs set for their tool shells. Null when unknown
// — the server then records the write as an anonymous agent, never as a guess.
export function detectAgent(env = process.env) {
  if (env.PRAX_AGENT) return sanitizeAgentId(env.PRAX_AGENT);
  if (env.CLAUDECODE) return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'codex';
  if (env.COPILOT_CLI || env.COPILOT_AGENT_SESSION_ID) return 'copilot';
  if (env.ANTIGRAVITY_AGENT || env.ANTIGRAVITY_CONVERSATION_ID) return 'antigravity';
  return null;
}

// The desktop app picks a free loopback port on first launch and persists it in
// `webview-port` under Tauri's app_data_dir (see src-tauri/src/lib.rs).
export function desktopPortFile({ env = process.env, os = platform(), home = homedir() } = {}) {
  if (os === 'darwin') return join(home, 'Library', 'Application Support', DESKTOP_IDENTIFIER, 'webview-port');
  if (os === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), DESKTOP_IDENTIFIER, 'webview-port');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), DESKTOP_IDENTIFIER, 'webview-port');
}

export function readDesktopPort(file, read = readFileSync) {
  try {
    const port = Number(String(read(file, 'utf8')).trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

// Candidate base URLs, most specific first. An explicit URL is authoritative
// (no fallback — a wrong URL must fail loudly, not silently hit another app).
export function resolveBaseUrls({ baseUrl, env = process.env, portFile, read } = {}) {
  // MOOMORA_API_URL is the pre-rename env var; still honoured so existing setups keep working.
  const explicit = baseUrl || env.PRAX_API_URL || env.MOOMORA_API_URL;
  if (explicit) return [String(explicit).replace(/\/$/, '')];
  const urls = [];
  const port = readDesktopPort(portFile || desktopPortFile({ env }), read);
  if (port) urls.push(`http://127.0.0.1:${port}`);
  urls.push(DEFAULT_BASE_URL);
  return urls;
}
