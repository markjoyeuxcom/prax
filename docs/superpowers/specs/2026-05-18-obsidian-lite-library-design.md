# Obsidian-Lite Library Design

## Goal

Make the Knowledge Library feel like a practical Markdown workspace, closer to Obsidian for day-to-day reading and editing of runbooks and notes.

## Problem

Large implementation plans such as `Cloudflare Tunnel Implementation Plan` do not preview correctly because the current Markdown renderer only supports headings, paragraphs, simple unordered lists, and fenced code blocks. These documents use blockquotes, inline formatting, inline code, links, ordered lists, nested bullets, task checkboxes, tables, horizontal rules, and many fenced code blocks.

## Scope

This slice improves the Markdown editor and preview experience. It does not add backlinks, graph view, folder trees, sync to local filesystem, plugins, or command palette.

## User Experience

The Library view becomes an editor workspace:

- Left: document list.
- Center/right workspace: mode-based document surface.
- Modes: `Edit`, `Preview`, and `Split`.
- Edit mode shows a large Markdown textarea with Save and dirty-state feedback.
- Preview mode shows rendered Markdown.
- Split mode shows editor and preview side by side.

Existing create/edit/archive/delete actions remain available, but editing a selected document happens in the workspace rather than only in a modal.

## Markdown Rendering

Preview supports:

- headings `#` through `######`
- paragraphs
- blockquotes
- bold and italic
- inline code
- links
- unordered lists
- ordered lists
- task checkboxes
- tables
- horizontal rules
- fenced code blocks with optional language labels

Preview remains safe: raw HTML is escaped and never executed.

## Testing

Tests cover the richer Markdown rendering patterns and the Library view modes, including editor, preview, split, save controls, and raw HTML escaping.
