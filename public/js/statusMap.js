// The design ↔ API translation seam.
// All view modules speak the Prax design vocabulary; only the API boundary
// (payload builders in main.js) translates. The HTTP API enum is unchanged:
// ['high-priority', 'in-progress', 'planned', 'completed', 'notes'].
//
// Design 'backlog' maps onto API 'notes' — historically a fifth board
// "parking lane" column with no other semantics, which is exactly what the
// design's Backlog tab is. 'archived' is NOT a status on either side of the
// seam; it is the archivedAt flag with its own endpoints.

const DESIGN_TO_API = {
  priority: 'high-priority',
  inprogress: 'in-progress',
  planned: 'planned',
  completed: 'completed',
  backlog: 'notes',
};

const API_TO_DESIGN = Object.fromEntries(
  Object.entries(DESIGN_TO_API).map(([design, api]) => [api, design]),
);

export const DESIGN_STATUSES = Object.keys(DESIGN_TO_API);

// Board columns in design order; backlog/archived tasks never board.
export const BOARD_COLUMNS = ['priority', 'inprogress', 'planned', 'completed'];

export function apiStatus(designStatus) {
  return DESIGN_TO_API[designStatus] || 'planned';
}

export function designStatus(apiStatusValue) {
  return API_TO_DESIGN[apiStatusValue] || 'planned';
}

// Priority is a rename only at the 'med' value; the API stores 'medium'.
export function apiPriority(designPriority) {
  return designPriority === 'med' ? 'medium' : (designPriority || 'medium');
}

export function designPriority(apiPriorityValue) {
  return apiPriorityValue === 'medium' ? 'med' : (apiPriorityValue || 'med');
}

// Convenience predicates for view filtering (design vocabulary).
export function isBoardable(task) {
  const status = designStatus(task.status);
  return status !== 'backlog' && !task.archivedAt;
}

export function isOpen(task) {
  const status = designStatus(task.status);
  return status !== 'completed' && status !== 'backlog' && !task.archivedAt;
}
