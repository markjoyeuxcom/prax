# CodeMirror as the sole editor engine

The experimental Plain editor is retired at the user's request. All documents open
in CodeMirror, including sessions whose saved preferences still select Plain.

- Remove the engine selector, action handler, preference, Plain implementation,
  and its dedicated styles and tests.
- Ignore the retired `editorEngine` key when loading preferences and omit it on
  subsequent preference saves. Preserve font, reading scale, line numbers, and
  all other supported preferences.
- Keep the shared Markdown helpers and CodeMirror's existing textarea recovery
  path if mounting fails. Draft saving and recovery behavior must remain intact.
- Preserve edit, split, preview, focus mode, and the current font controls.

Evidence: preference compatibility tests and a browser journey that starts with
a saved Plain preference, edits through CodeMirror, verifies persistence, and
checks Settings. Run the existing editor recovery/reflow journeys, `npm test`,
and `npm run check` before reporting completion.
