# Remove the experimental Plain editor

Design: [CodeMirror as the sole editor engine](../specs/2026-09-06-codemirror-only-design.md).

1. Add regression coverage for retired preferences and the existing-user browser
   journey; run it against the old implementation to observe the failure.
2. Remove the Plain implementation, controls, styles, and preference. Keep shared
   Markdown formatting, CodeMirror font controls, and failure recovery.
3. Run unit/contract and syntax/bundle checks plus affected browser journeys.
4. Review the diff for dangling references and accidental draft-lifecycle changes;
   record the observed results below.

## Verification and review

- Before implementation, the preference regression failed because the retired key
  was retained. The browser regression failed because a saved Plain preference
  mounted Plain and no CodeMirror edit surface existed.
- `npm test`: **1,873 passed, 0 failed, 0 skipped**. Removed tests cover the deleted
  Plain implementation and its caret line-height calculation; shared Markdown
  helper tests remain.
- `npm run check`: exit 0; **skill bundles are up to date**.
- With `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-codex-review-browsers` and
  `PRAX_E2E_PORT=3614`, the existing `editor-autosave.spec.js`,
  `library-editor-reflow.spec.js`, and `links-section.spec.js` journeys all
  passed: **12 tests**.
- The new `codemirror-only.spec.js` initially assumed a different monospace font;
  corrected the test to the existing system-monospace design. It then passed,
  including exact body persistence/reload and both font choices. The Library/editor
  and Settings accessibility journeys also passed: **3 tests** in the final run.
  **15 targeted browser tests passed in total**, using an isolated in-memory server.
- Reviewed the final diff: no production references to the Plain implementation,
  engine preference, selector, or dedicated CSS remain. CodeMirror's shared font
  token is now `--editor-font`; draft-saving and recovery logic remain unchanged.
  `git diff --check` passed.

No native desktop build or full browser-suite run was performed for this removal.

## Subsequent readiness verification

The full Chromium suite subsequently passed **113 tests**. The rebuilt native debug
app also passed the two-launch smoke test with data and browser-origin persistence
across 26 migrations. See [menu-bar verification](2026-09-06-menu-bar-icon.md).
