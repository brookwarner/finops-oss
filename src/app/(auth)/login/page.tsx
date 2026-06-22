"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { FinopsMark } from "@/components/finops-mark";

function isValidNext(raw: string | null): raw is string {
  if (!raw) return false;
  try {
    return new URL(raw, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const next = searchParams.get("next");
    const callback = isValidNext(next)
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <FinopsMark className="mb-5 h-12 w-12" />
      <h1 className="mb-6 text-[26px] font-bold tracking-tight">Sign in to FinOps</h1>
      {sent ? (
        <p className="text-sm text-ink-muted">Check your email for the magic link.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-ink placeholder:text-ink-faint"
          />
          <button type="submit" className="w-full rounded-control bg-accent px-3 py-2 font-medium text-white transition-colors hover:brightness-110">
            Send magic link
          </button>
          {error && <p className="text-sm text-negative">{error}</p>}
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
