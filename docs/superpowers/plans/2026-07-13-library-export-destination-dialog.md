# Library Export Destination Dialog Plan

**Design:** `docs/superpowers/specs/2026-07-13-library-export-destination-dialog-design.md`

1. Add a pure shared export-dialog renderer and destination-capability model.
2. Add browser-picker, desktop-native, and explicit Downloads fallback save paths.
3. Route Library and Settings Markdown export actions through the dialog with exact focus return.
4. Add a narrowly scoped desktop save command and native dialog plugin.
5. Cover renderer, save transport, browser journey, and Rust filename behavior.
6. Run the complete unit, syntax, browser, portable, restore, and desktop gates.

## Completion evidence

- Library and Settings use one scope/destination dialog with exact focus return.
- Desktop opens a native Save dialog and accepts no webview-supplied path; Chromium writes through a
  user-selected file handle; unsupported browsers explicitly use Downloads.
- 161 unit files, 49 browser journeys, syntax checks, portable/restore drills, the Rust unit test,
  and all-target desktop compilation passed.

### Desktop permission repair

The live desktop check identified Tauri's remote-origin ACL guard. `save_library_export` is now
declared in the application manifest and is the only application command granted to the localhost
capability. A contract regression, 161-file unit run, syntax checks, three focused browser journeys,
Rust unit/all-target checks, generated-schema inspection, and a fresh desktop debug build passed.
