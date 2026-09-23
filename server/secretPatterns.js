// Credential shapes, shared by the session harvester (cli/lib/harvest.js skips a
// candidate that carries one) and recall telemetry (server/recallTelemetry.js
// redacts them from a query before storing it). It lives under server/ because
// the server must not import from cli/, while cli/ and the skill bundles may
// import from server/.
//
// Two sets:
// - CREDENTIAL_PATTERNS are self-identifying token shapes (a private-key
//   header, AWS access key ids, GitHub, GitLab, Slack, OpenAI and Anthropic
//   tokens). A match is almost never a false positive, so the harvester refuses
//   the whole candidate on one.
// - CONTEXTUAL_PATTERNS recognise a secret by what surrounds it: an
//   `Authorization: Bearer …` value, `password=…`-style assignments, userinfo
//   in a URL and JWTs. They can match harmless text ("token: rotation"), which
//   costs a redacted word in a stored query but would cost a lost memory in the
//   harvester, so only redaction uses them.

// Detection patterns: no global flag, so `.test` has no lastIndex state.
export const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
]);

export function looksLikeCredential(text) {
  const value = String(text ?? '');
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

export const REDACTED = '[redacted]';

// Redaction rules, applied in order. `keep` is how many leading capture groups
// survive (a label such as `Bearer ` or `password=`); the rest of the match is
// replaced by REDACTED. A private-key block is redacted from its header to its
// END line, or to the end of the text when the END line is missing.
const REDACTIONS = Object.freeze([
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, keep: 0 },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, keep: 0 },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, keep: 0 },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g, keep: 0 },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, keep: 0 },
  { pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, keep: 0 },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, keep: 0 },
  // `Authorization: Bearer <token>`, `Basic <b64>`, `token <value>`.
  { pattern: /(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, keep: 1 },
  // `password=…`, `api_key: …`, `AWS_SECRET_ACCESS_KEY=…`: the label stays.
  {
    pattern: /(\b[A-Za-z0-9_]*(?:password|passwd|passphrase|pwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|token)[A-Za-z0-9_]*\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;&]+)/gi,
    keep: 1,
  },
  // Userinfo in a URL: https://user:pass@host keeps the user and the host.
  { pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi, keep: 1 },
]);

// The text with every credential span replaced by REDACTED and everything else
// kept, so a query stays readable ("rotate [redacted] for deploys") while the
// secret is gone.
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const { pattern, keep } of REDACTIONS) {
    out = out.replace(pattern, (...args) => {
      const groups = args.slice(1, 1 + keep);
      return `${groups.join('')}${REDACTED}`;
    });
  }
  return out;
}
