// Shared wording for semantic results that cover only the current part of the index.
export function incompleteIndexNotice(index) {
  if (!index || !Number.isInteger(index.pending) || index.pending <= 0
    || !Number.isInteger(index.embedded) || index.embedded < 0
    || !Number.isInteger(index.total) || index.total < index.embedded) return '';
  return `Search index is incomplete: ${index.embedded} of ${index.total} documents are current; ${index.pending} pending. Re-index in Settings ▸ Intelligence to include them.`;
}
