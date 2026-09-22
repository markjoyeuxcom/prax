// cli/lib/cliArgs.js — argument parsing for the prax CLI entry point.
//
// `--flag value` and `--flag=value` are equivalent. The `=` form is the way to
// pass a value that itself begins with `--` (a checklist item such as
// "--json output is documented"): with the spaced form that value would be
// read as the next flag and the intended flag would become a bare `true`.
// A lone `--` ends the flags: every later word is a positional.
// Flags listed in `repeatable` accumulate into an array; every other flag
// keeps last-wins (which `--tag` documents).
//
// With a declared spec (`known`), parsing is strict (QINV-01): an unknown
// flag, a boolean flag given a value, and a value-taking flag given none are
// all refused instead of being stored and ignored. `boolean` flags never take
// the next word as their value; an `optional` flag takes it only when its
// predicate accepts it (`--recent 5`, but not `--recent postgres`). Without a
// spec every flag is value-taking and nothing is refused (the legacy shape).
export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const needsValue = (key) => `--${key} needs a value; for text that starts with "--" write --${key}="<text>".`;

// Levenshtein distance, for "did you mean" on a mistyped flag (--tpye).
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

export function suggestFlag(key, names) {
  let best = null;
  let bestScore = Infinity;
  for (const name of names) {
    const score = distance(key, name);
    if (score < bestScore) { best = name; bestScore = score; }
  }
  return best !== null && bestScore <= 2 ? best : null;
}

export function parseArgs(argv, {
  repeatable = [], boolean = [], optional = {}, known, aliases = {},
} = {}) {
  const multi = new Set(repeatable);
  const bools = new Set(boolean);
  const strict = Array.isArray(known) || known instanceof Set;
  const names = strict ? new Set([...known, ...bools, ...multi, ...Object.keys(optional)]) : null;
  const positionals = [];
  const flags = {};
  const spelledAs = new Map();
  const set = (key, value) => {
    if (multi.has(key)) (flags[key] ||= []).push(value);
    else flags[key] = value;
  };
  const resolve = (raw) => {
    const key = Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : raw;
    if (strict && !names.has(key)) {
      const hint = suggestFlag(key, names);
      throw new CliUsageError(`Unknown flag --${raw}${hint ? ` (did you mean --${hint}?)` : ''}.`);
    }
    // An alias and its canonical name together would be last-wins between
    // two spellings of one intent; refuse rather than pick one.
    const earlier = spelledAs.get(key);
    if (earlier !== undefined && earlier !== raw) {
      throw new CliUsageError(`--${earlier} and --${raw} are the same flag; give it once.`);
    }
    spelledAs.set(key, raw);
    return key;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq > 2) {
      const key = resolve(arg.slice(2, eq));
      if (strict && bools.has(key)) throw new CliUsageError(`--${key} takes no value.`);
      set(key, arg.slice(eq + 1));
      continue;
    }
    const key = resolve(arg.slice(2));
    if (bools.has(key)) { set(key, true); continue; }
    const next = argv[i + 1];
    if (optional[key]) {
      if (next !== undefined && optional[key](next)) { set(key, next); i += 1; } else set(key, true);
      continue;
    }
    if (next === undefined || next.startsWith('--')) {
      // A value-taking flag with nothing after it. Strict parsing refuses it
      // here; the legacy shape records `true` for flagValue to refuse.
      if (strict) throw new CliUsageError(needsValue(key));
      set(key, true);
    } else {
      set(key, next);
      i += 1;
    }
  }
  return { positionals, flags };
}

// Per-command check after parsing: every given flag must belong to this
// command, and the positional count must fit. `max` counts the words after
// the command (and subcommand) itself.
export function checkCommandArgs(label, { flags, positionals }, {
  allowed, min = 0, max = Infinity, usage = '',
}) {
  const allow = new Set(allowed);
  for (const key of Object.keys(flags)) {
    if (!allow.has(key)) {
      throw new CliUsageError(`${label} does not take --${key}.${usage ? `\nUsage: ${usage}` : ''}`);
    }
  }
  if (positionals.length > max) {
    const extra = positionals.slice(max).map((w) => `"${w}"`).join(' ');
    const quote = max === 1 ? ' — quote a value that contains spaces' : '';
    throw new CliUsageError(`${label}: unexpected argument${positionals.length - max === 1 ? '' : 's'} ${extra}${quote}.${usage ? `\nUsage: ${usage}` : ''}`);
  }
  if (positionals.length < min) {
    throw new CliUsageError(`${label}: missing argument.${usage ? `\nUsage: ${usage}` : ''}`);
  }
}

// A positive integer flag (--limit, --recent n), or undefined when absent.
export function positiveIntFlag(flags, key) {
  const value = flags[key];
  if (value === undefined || value === true) return undefined;
  const text = String(value).trim();
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < 1) {
    throw new CliUsageError(`--${key} must be a positive integer (got "${value}").`);
  }
  return n;
}

// A value-taking flag's text, or undefined when it was not given. A bare
// occurrence (no value, or a value beginning with `--` that was read as the
// next flag) is refused: turning it into '' or dropping it would silently
// discard what the caller typed — for `remember --body`, an empty body
// written over a stored document.
export function flagValue(flags, key) {
  const value = flags[key];
  if (value === undefined) return undefined;
  if (value === true) throw new Error(needsValue(key));
  return String(value);
}

// A repeatable text flag's values, refusing a bare occurrence instead of
// silently dropping it (a checklist item that was never created is a lost
// acceptance check, not a harmless omission).
export function repeatedValues(flags, key) {
  const values = Array.isArray(flags[key]) ? flags[key] : [];
  const bare = values.findIndex((v) => v === true);
  if (bare !== -1) throw new Error(needsValue(key));
  return values.map(String);
}
