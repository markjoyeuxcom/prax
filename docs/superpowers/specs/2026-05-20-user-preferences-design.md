# User Preferences Settings Design

## Goal

Add a dedicated Settings panel for browser-local user preferences. The first version focuses on appearance controls: fixed interface font size and site colour palette. Preferences must apply immediately, persist in the current browser, and avoid cookies or backend storage.

## Scope

In scope:

- A Settings button in the app header.
- A modal-style Settings panel with sections for Appearance, Data, and About.
- Appearance controls for fixed interface size: Compact, Comfortable, and Large.
- Palette controls for Console, Graphite, and Daylight.
- Reset preferences action.
- Browser-local persistence with `localStorage`.
- Immediate UI updates without page refresh.
- Tests for preference normalization, persistence, render output, and UI application.

Out of scope for this version:

- User accounts or server-side preference sync.
- Cookies.
- Database schema changes.
- Per-context or per-document preferences.
- Custom palette editor.
- Separate editor-only and preview-only font sizes.

## Product Model

Settings is distinct from Admin Operations. Admin remains focused on backup, import, restore, and archive maintenance. Settings is for personal workspace behavior and presentation.

The first panel sections are:

- Appearance: active in v1.
- Data: present as a read-only section showing that preferences are stored in this browser and that backup/import controls remain under Admin Operations.
- About: app identity and local storage note.

Appearance includes:

- Interface size:
  - `compact`: smaller dense operations UI.
  - `comfortable`: current default.
  - `large`: larger reading and control scale.
- Palette:
  - `console`: current dark blue/green palette.
  - `graphite`: neutral dark palette with reduced blue dominance.
  - `daylight`: light GitHub-like palette.
- Reset:
  - clears saved preferences and returns to `comfortable` + `console`.

## Persistence

Use one localStorage key:

```text
moomora-console.preferences
```

Store a compact JSON object:

```json
{
  "fontScale": "comfortable",
  "palette": "console"
}
```

Invalid, missing, or malformed values fall back to defaults. Loading preferences must never block app startup; errors return defaults.

No cookies are set. Preferences are not sent to the server.

## Rendering And State

Add preference state to the frontend state module:

- `isSettingsPanelOpen`
- `settingsSection`
- `preferences`

Add a small preference helper module responsible for:

- defaults
- allowed values
- parsing saved JSON
- saving preferences
- resetting preferences
- applying preferences to the document root

The document root receives attributes:

```html
<html data-font-scale="comfortable" data-palette="console">
```

CSS uses these attributes to apply palette variables and size variables. This keeps rendering simple and avoids rewriting large chunks of HTML.

## CSS Strategy

Keep the existing `:root` variables as the Console default. Add palette overrides with attribute selectors:

- `:root[data-palette="graphite"]`
- `:root[data-palette="daylight"]`

Add size variables:

- `--font-scale`
- derived variables for editor and preview text where needed.

The first implementation avoids chasing every individual `font-size`. It sets a base scale on `body` and then adjusts the most user-visible fixed text areas:

- app shell text
- task/document lists
- Markdown preview
- CodeMirror editor
- fallback textarea editor
- form controls

Code blocks remain monospace. The editor remains monospace.

## UI Behavior

Settings opens from the header next to Admin and New Document.

Changing a preference:

- updates state
- saves to localStorage
- applies root attributes immediately
- leaves the Settings panel open

Reset:

- removes or overwrites the localStorage value with defaults
- reapplies defaults immediately

Keyboard and accessibility behavior:

- Settings panel uses `role="dialog"` and `aria-modal="true"`.
- Close button is keyboard reachable.
- Radio/segmented controls use real buttons or radio inputs with clear selected state.
- Visible labels are concise and operational, not explanatory tutorial text.

## Error Handling

If localStorage is unavailable, preference updates still apply for the current runtime state. Saving failures are ignored silently for v1 because preferences are non-critical.

If saved JSON is invalid, the app uses defaults and can overwrite with valid JSON on the next preference change.

## Testing

Add unit tests for:

- preference defaults
- parsing valid saved preferences
- rejecting invalid saved preferences
- applying root attributes
- resetting preferences
- Settings panel rendering selected font scale and palette
- header includes Settings action

Run existing checks:

- `npm run check`
- `npm test`

## Future Work

Later versions can add:

- backend-synced preferences after authentication/users exist
- separate editor and preview text size controls
- AI/MCP preference section
- import/export of preference profile with backup data
- custom accent colour selection
