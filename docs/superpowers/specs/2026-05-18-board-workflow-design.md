# Board Workflow Design

## Goal

Make the Board view operational: cards can move between columns, card order is saved, and the behavior will work with the same API against the local fixture server and CloudNativePG-backed deployment.

## Scope

This slice covers native drag/drop for board cards, status changes when cards move between columns, persisted `sortOrder` updates, and basic failure recovery. It does not add swimlanes, WIP limits, bulk selection, keyboard reordering, or activity-log entries.

## User Experience

The Board view remains the existing five-column operations board: High Priority, In Progress, Planned, Completed, and Notes. Cards become draggable, columns show a clear drop target state, and dropping a card either appends it to a column or places it before the card it was dropped on. The selected task follows the moved card so the detail panel stays useful after a move.

If persistence fails, Moomora Console alerts the user and reloads tasks from the API to avoid leaving the UI in a misleading state.

## API

Add `PATCH /api/tasks/reorder` with this JSON shape:

```json
{
  "tasks": [
    { "id": "11111111-1111-4111-8111-111111111111", "status": "in-progress", "sortOrder": 0 }
  ]
}
```

The route validates each task id, status, and integer `sortOrder`. It returns the updated tasks from the repository. Invalid payloads return `400`; unknown or archived rows are simply omitted from the returned updated set.

## Data Flow

The browser computes the new board ordering from the current active-context task set. It updates local state optimistically, sends the compact reorder payload to the API, and then reloads tasks to reconcile with the backend. The repository persists status and `sort_order` in one batch query.

## Testing

Tests cover board markup hooks, the pure move calculation, the frontend API helper, route validation, and the repository batch query builder. Browser smoke verifies that a card can be dropped into another column and remains selected after the move.
