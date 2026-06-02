export function toIso(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}
