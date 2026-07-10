// Starting points for a new library document. Each template seeds the title,
// documentType, and body; the Library "＋ New doc" menu offers them and
// createNewDocument (main.js) applies the chosen one. Keep the list short — the
// menu is a quick chooser, not a gallery.
export const DOCUMENT_TEMPLATES = [
  {
    id: 'note',
    label: 'Blank note',
    hint: 'A fresh, empty document',
    documentType: 'note',
    title: 'Untitled',
    body: '# Untitled\n\n',
  },
  {
    id: 'runbook',
    label: 'Runbook',
    hint: 'Symptoms · Diagnosis · Resolution · Verification',
    documentType: 'runbook',
    title: 'Untitled runbook',
    // Headings only (no placeholder prose to delete); the outline rail shows
    // the sections immediately, and Resolution starts a numbered list.
    body: [
      '# Untitled runbook',
      '',
      '## Symptoms',
      '',
      '## Diagnosis',
      '',
      '## Resolution',
      '',
      '1. ',
      '',
      '## Verification',
      '',
      '## Rollback',
      '',
    ].join('\n'),
  },
  {
    id: 'decision',
    label: 'Decision',
    hint: 'Context · Decision · Consequences',
    documentType: 'decision',
    title: 'Untitled decision',
    body: [
      '# Untitled decision',
      '',
      '## Context',
      '',
      '## Decision',
      '',
      '## Consequences',
      '',
    ].join('\n'),
  },
  {
    id: 'known-issue',
    label: 'Known issue',
    hint: 'Symptoms · Workaround · Root cause',
    documentType: 'known-issue',
    title: 'Untitled known issue',
    body: [
      '# Untitled known issue',
      '',
      '## Symptoms',
      '',
      '## Workaround',
      '',
      '## Root cause',
      '',
    ].join('\n'),
  },
  {
    id: 'reference',
    label: 'Reference',
    hint: 'Links, tables, lookup material',
    documentType: 'reference',
    title: 'Untitled reference',
    body: '# Untitled reference\n\n',
  },
];

// Look up a template by id; falls back to the first (blank note) for an unknown
// or missing id, so callers never get undefined.
export function templateById(id) {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id) || DOCUMENT_TEMPLATES[0];
}
