export function toVectorLiteral(vector) {
  if (!Array.isArray(vector)) throw new Error('vector must be an array');
  for (const n of vector) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error('vector must contain only finite numbers');
    }
  }
  return `[${vector.join(',')}]`;
}
