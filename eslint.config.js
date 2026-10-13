// Undefined-identifier gate only. `node --check` (npm run check) catches syntax
// errors but not a reference to a variable that was never declared in that
// scope, which is exactly the class of defect found in v0.44.0's review (a
// stray `verifiedOnly` inside a route that had none; the route's try/catch
// turned it into a silent keyword fallback). Style and the rest stay out of
// the gate on purpose: this is a lint for mistakes, not for taste.
//
// Scope: every shipped JavaScript entry point and module (server, CLI, MCP,
// skills sources, scripts, browser UI, desktop splash) plus the build/test
// configs. Tests are deliberately out: they run under node:test and
// Playwright, which fail loudly on an undefined name. Generated bundles
// (public/vendor, the skill bundles, the Tauri resources copy) are not linted.
import globals from 'globals';

const ES = globals.es2024;
// Browser-only code: a Node global here (process, Buffer, require) is a bug.
const browserFiles = ['public/js/**/*.js', 'scripts/codemirror-editor-source.js', 'src-tauri/splash/*.js'];
// Node ESM code; the browser-side callbacks of the screenshot harness are the
// one file that legitimately mixes both environments.
const mixedFiles = ['scripts/capture-readme-screenshots.mjs'];

export default [
  {
    ignores: [
      'node_modules/**', 'public/vendor/**', 'skills/prax-recall/**', 'skills/prax-remember/**', 'dist/**',
      'tests/**', 'docs/**', 'src-tauri/target/**', 'src-tauri/resources/**', '.worktrees/**', '.local-review-backups/**',
    ],
  },
  {
    files: ['server/**/*.js', 'cli/**/*.js', 'mcp/**/*.js', 'skills/src/**/*.mjs', 'scripts/**/*.{js,mjs}', 'eslint.config.js', 'playwright.config.js'],
    ignores: [...browserFiles, ...mixedFiles],
    // ES modules: require, __dirname and module are not in scope unless the
    // file makes them (createRequire), so the built-in set, not the CommonJS one.
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.nodeBuiltin, ...ES } },
    rules: { 'no-undef': 'error' },
  },
  {
    files: browserFiles,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...ES } },
    rules: { 'no-undef': 'error' },
  },
  {
    files: mixedFiles,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.nodeBuiltin, ...globals.browser, ...ES } },
    rules: { 'no-undef': 'error' },
  },
];
