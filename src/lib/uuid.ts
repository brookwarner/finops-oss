/**
 * Canonical UUID matcher. Used to tell a real (UUID) category id apart from a
 * sentinel like "uncategorised" before we learn a rule or trust client input.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
