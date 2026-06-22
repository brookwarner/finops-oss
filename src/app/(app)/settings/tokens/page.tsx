import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { MintForm, RevokeButton } from "./mint-form";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const { data: tokens, error } = await supabase
    .from("access_tokens")
    .select("id, name, prefix, last_used_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-negative">Error: {error.message}</p>;
  }

  return (
    <section className="pb-12">
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Access tokens</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Personal access tokens for the MCP connector. Treat them like passwords.{" "}
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent hover:underline"
        >
          API reference →
        </a>
      </p>

      <MintForm />

      {tokens && tokens.length > 0 ? (
        <ul className="space-y-2.5">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="rounded-row bg-surface p-4 text-sm shadow-row"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-ink">{t.name}</div>
                <RevokeButton id={t.id} />
              </div>
              <div className="mt-1 font-mono text-xs text-ink-muted">
                {t.prefix}…
              </div>
              <div className="text-xs text-ink-faint">
                Last used:{" "}
                {t.last_used_at ? formatDateTime(t.last_used_at) : "never"}{" "}
                · Created:{" "}
                {t.created_at ? formatDateTime(t.created_at) : "—"}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No tokens yet.</p>
      )}
    </section>
  );
}
