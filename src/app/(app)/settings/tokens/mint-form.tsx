"use client";
import { useState } from "react";
import { mintToken, revokeToken } from "./actions";

export function MintForm() {
  const [name, setName] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setBusy(true);
    setError(null);
    setRaw(null);
    setCopied(false);
    try {
      const r = await mintToken(name.trim());
      setRaw(r.raw);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mb-6 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-ink-muted">Token name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MCP token"
            className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="cursor-pointer rounded-control bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create token"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {raw && (
        <div className="mt-4 rounded-control border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 text-sm font-medium text-warning">
            Copy this now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-surface px-2 py-1.5 font-mono text-sm text-ink">
              {raw}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="cursor-pointer rounded-control border border-hairline bg-surface px-3 py-1.5 text-sm text-ink hover:bg-sunken"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);

  async function onRevoke() {
    setBusy(true);
    try {
      await revokeToken(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onRevoke}
      disabled={busy}
      className="cursor-pointer rounded-control border border-negative/30 px-2 py-0.5 text-xs text-negative transition-colors hover:bg-negative-weak disabled:opacity-50"
    >
      {busy ? "Revoking…" : "Revoke"}
    </button>
  );
}
