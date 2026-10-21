"use client";
import { useState } from "react";
import { inviteMember, revokeInvite } from "./actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function onInvite() {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setInvited(null);
    try {
      await inviteMember(value);
      setInvited(value);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite");
    } finally {
      setBusy(false);
    }
  }

  const loginUrl =
    typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  return (
    <div className="mb-6 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-ink-muted">Invite by email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@example.com"
            className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>
        <button
          type="button"
          onClick={onInvite}
          disabled={busy}
          className="cursor-pointer rounded-control bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {invited && (
        <div className="mt-4 rounded-control border border-accent/30 bg-accent/10 p-3 text-sm text-ink">
          <p className="font-medium">Invited {invited}.</p>
          <p className="mt-1 text-ink-muted">
            Tell them to sign in at <span className="font-mono">{loginUrl}</span> with
            this email — they&apos;ll get a magic link and join automatically.
          </p>
        </div>
      )}
    </div>
  );
}

export function RevokeInviteButton({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRevoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeInvite(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRevoke}
        disabled={busy}
        className="cursor-pointer rounded-control border border-negative/30 px-2 py-0.5 text-xs text-negative transition-colors hover:bg-negative-weak disabled:opacity-50"
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-negative">{error}</span>}
    </div>
  );
}
