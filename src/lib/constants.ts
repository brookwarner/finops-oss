// Inbox only surfaces uncategorised transactions on or after this date.
// Older history (imported from PocketSmith) isn't worth triaging by hand,
// so we exclude it from both the inbox list and the nav badge count.
export const INBOX_CUTOFF = "2026-01-01T00:00:00Z";

// PocketSmith history is authoritative up to the handoff; Akahu is the live
// source from this day on. Used to dedup transactions that appear in both
// sources around the boundary (Akahu posts settlement dates a few days late).
export const POCKETSMITH_BOUNDARY = "2026-04-30T00:00:00Z";

// Only transactions whose occurred_at falls within +/- this many days of the
// boundary are checked for cross-source duplicates. Comfortably covers the
// +/-7-day match tolerance around the handoff while keeping the scan cheap.
export const DEDUP_OVERLAP_WINDOW_DAYS = 14;
