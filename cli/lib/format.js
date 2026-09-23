export function trustTag(doc) {
  if ((doc.status || 'active') === 'superseded') return '[superseded]';
  if ((doc.status || 'active') === 'deprecated') return '[deprecated]';
  return doc.verified ? '[verified]' : '[unverified]';
}

// The trust a document actually has, for a confirmation line: a remember that
// leaves the title and body unchanged keeps an earlier human verification.
export function trustLabel(doc) {
  if (!doc?.verified) return 'unverified';
  return doc.verifiedBy ? `verified by ${doc.verifiedBy}` : 'verified';
}

export function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) return 'No results.';
  return results
    .map((r) => {
      const head = `• ${r.title || 'Untitled'} ${trustTag(r)}  (${r.id})`;
      const snip = r.snippet ? `\n    ${String(r.snippet).replace(/\s+/g, ' ').trim()}` : '';
      return head + snip;
    })
    .join('\n');
}

export function formatDocument(doc) {
  if (!doc) return 'Document not found.';
  const lines = [
    `${doc.title || 'Untitled'} ${trustTag(doc)}`,
    `updated by ${doc.updatedBy || 'user'}${doc.verifiedBy ? ` · verified by ${doc.verifiedBy}` : ''}`,
    '',
    String(doc.body || ''),
  ];
  return lines.join('\n');
}
