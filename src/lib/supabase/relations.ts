/**
 * Unwrap a Supabase embedded (to-one) relation.
 *
 * PostgREST returns an embedded relation as either a single object or a
 * one-element array depending on how the foreign key is introspected, so call
 * sites kept reaching for `Array.isArray(row.rel) ? row.rel[0] : row.rel`. This
 * normalises both shapes to the first row (or `null` when absent/empty).
 */
export function getFirstNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
