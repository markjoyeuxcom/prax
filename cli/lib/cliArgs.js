// cli/lib/cliArgs.js — argument parsing for the prax CLI entry point.
//
// `--flag value` and `--flag=value` are equivalent. The `=` form is the way to
// pass a value that itself begins with `--` (a checklist item such as
// "--json output is documented"): with the spaced form that value would be
// read as the next flag and the intended flag would become a bare `true`.
// Flags listed in `repeatable` accumulate into an array; every other flag
// keeps last-wins (which `--tag` documents).
export function parseArgs(argv, { repeatable = [] } = {}) {
  const multi = new Set(repeatable);
  const positionals = [];
  const flags = {};
  const set = (key, value) => {
    if (multi.has(key)) (flags[key] ||= []).push(value);
    else flags[key] = value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq > 2) { set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      set(key, true);
    } else {
      set(key, next);
      i += 1;
    }
  }
  return { positionals, flags };
}

// A value-taking flag's text, or undefined when it was not given. A bare
// occurrence (no value, or a value beginning with `--` that was read as the
// next flag) is refused: turning it into '' or dropping it would silently
// discard what the caller typed — for `remember --body`, an empty body
// written over a stored document.
export function flagValue(flags, key) {
  const value = flags[key];
  if (value === undefined) return undefined;
  if (value === true) {
    throw new Error(`--${key} needs a value; for text that starts with "--" write --${key}="<text>".`);
  }
  return String(value);
}

// A repeatable text flag's values, refusing a bare occurrence instead of
// silently dropping it (a checklist item that was never created is a lost
// acceptance check, not a harmless omission).
export function repeatedValues(flags, key) {
  const values = Array.isArray(flags[key]) ? flags[key] : [];
  const bare = values.findIndex((v) => v === true);
  if (bare !== -1) {
    throw new Error(`--${key} needs a value; for text that starts with "--" write --${key}="<text>".`);
  }
  return values.map(String);
}
