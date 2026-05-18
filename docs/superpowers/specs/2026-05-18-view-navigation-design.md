# View Navigation Design

**Date:** 2026-05-18  
**Status:** Approved for planning  

## Overview

This slice makes the left-rail views real. Today remains the default task queue, Board becomes a Kanban-style status overview, Backlog focuses planned work without a due date, and Archive shows archived tasks read-only.

## Goals

- Wire Today, Board, Backlog, and Archive navigation.
- Keep search and context switching working across views.
- Add a Kanban-style board grouped by status.
- Make Backlog a focused list of planned tasks with no due date.
- Make Archive fetch archived tasks and prevent edit/archive actions there.

## Non-Goals

- Drag/drop reordering.
- Restoring archived tasks.
- Hard delete.
- Calendar view.
- Import/export implementation.

## User Experience

### Today

Today keeps the existing task queue and detail panel for active tasks in the selected context. Search filters this queue locally.

### Board

Board shows columns for:

- High Priority
- In Progress
- Planned
- Completed
- Notes

Each task appears as a compact card. Clicking a card selects it and updates the detail panel. Editing and archiving remain available from the detail panel for active tasks.

### Backlog

Backlog shows active tasks whose status is `planned` and whose due date is empty. It uses the same list/detail workspace as Today.

### Archive

Archive fetches `/api/tasks?context=<context>&archived=true`, shows archived tasks in a list/detail workspace, and hides Edit and Archive actions. It is read-only in this slice.

## Architecture

- `public/js/taskViews.js`: pure helpers for view-specific task filtering and read-only state.
- `public/js/renderBoard.js`: pure renderer for board columns and task cards.
- `public/js/renderList.js`: accept options for title, count label, empty state, and active view switch.
- `public/js/renderTaskDetail.js`: accept `{ readOnly }` and hide actions when read-only.
- `public/js/main.js`: wire view buttons, fetch active or archived tasks depending on view, render list or board workspace, keep search/context behavior.
- `public/styles.css`: board column/card styling and responsive layout.

## Data Flow

The backend remains the source of truth. Active views fetch active tasks for the current context. Archive fetches archived tasks for the current context. Search stays client-side against the loaded view data.

## Testing

- `taskViews` tests cover Today/Board passthrough, Backlog filtering, Archive read-only detection.
- `renderBoard` tests cover columns, cards, escaping, and selected card state.
- Existing render list/detail tests cover options and archive read-only actions.
- Full suite must pass after wiring.

## Acceptance Criteria

- Clicking Today, Board, Backlog, and Archive changes the main heading and workspace.
- Board displays status columns and selectable task cards.
- Backlog only shows planned tasks without due dates.
- Archive fetches archived tasks and shows a read-only detail panel.
- Search filters the currently visible view.
- Context switching refetches the current view correctly.
