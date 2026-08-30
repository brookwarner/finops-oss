// One-off: LLM-categorise the inbox residual locally against the live DB.
// Mirrors src/lib/categorise/llm.ts (prompt + resolve), but uncapped and with
// an exclusion list for the rows the owner is handling manually in the UI.
//
//   node scripts/llm_categorise_residual.mjs            # dry-run (no writes)
//   node scripts/llm_categorise_residual.mjs --apply    # write category_id + needs_review
//
// Env loaded from .env.local: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// --- env ---
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");
const MODEL = "claude-haiku-4-5-20251001";
const THRESHOLD = 0.75;
const BATCH = 40;

// Rows the owner reserved for the UI (Lists A/B + big one-offs) — never touch.
const RESERVED =
  /wbc internet|one time pmt|mr & mrs warner|warner - wa|door phone|\breno\b|prof fee|presland|pay the owner warner|00033230/i;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function buildPrompt(txns, categories) {
  const taxonomy = categories
    .map((c) => `- ${c.name} (group: ${c.group ?? "—"}, kind: ${c.kind ?? "—"})`)
    .join("\n");
  const items = txns
    .map((t) =>
      JSON.stringify({ id: t.id, merchant: t.merchant, description: t.description, amount: t.amount, account_type: t.account_type }),
    )
    .join("\n");
  return [
    "You are categorising personal bank transactions for a New Zealand household.",
    "Choose the single best category for each transaction from this taxonomy:",
    taxonomy,
    "",
    "Transactions (one JSON object per line):",
    items,
    "",
    "Return ONLY a JSON array, one object per transaction, shape:",
    '[{"id": "<txn id>", "category_name": "<exact category name from the taxonomy>", "confidence": <0..1>}]',
    "Use the EXACT category name. If unsure, give a low confidence. No prose, JSON only.",
  ].join("\n");
}

async function suggest(txns, categories) {
  if (!txns.length) return [];
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(txns, categories) }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  const { data: categories, error: cErr } = await supa.from("categories").select("id, name, group, kind");
  if (cErr) throw cErr;
  const idByName = new Map(categories.map((c) => [c.name.toLowerCase().trim(), c.id]));

  const { data: rows, error: tErr } = await supa
    .from("transactions")
    .select("id, merchant, description, amount, accounts(type)")
    .is("category_id", null)
    .eq("is_manual_category", false);
  if (tErr) throw tErr;

  const all = rows.map((r) => {
    const acct = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
    return { id: r.id, merchant: r.merchant, description: r.description, amount: Number(r.amount), account_type: acct?.type ?? null };
  });
  const reserved = all.filter((t) => RESERVED.test(t.description ?? ""));
  const work = all.filter((t) => !RESERVED.test(t.description ?? ""));
  console.log(`uncategorised=${all.length}  reserved(skip)=${reserved.length}  to-process=${work.length}  mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  const counts = {};
  let applied = 0, lowconf = 0, unresolved = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    const batch = work.slice(i, i + BATCH);
    const raw = await suggest(batch, categories);
    const byId = new Map(raw.map((s) => [s.id, s]));
    for (const t of batch) {
      const s = byId.get(t.id);
      if (!s || typeof s.confidence !== "number" || s.confidence < THRESHOLD) { lowconf++; continue; }
      const catId = idByName.get((s.category_name ?? "").toLowerCase().trim());
      if (!catId) { unresolved++; continue; }
      counts[s.category_name] = (counts[s.category_name] ?? 0) + 1;
      if (APPLY) {
        const { error } = await supa
          .from("transactions")
          .update({ category_id: catId, needs_review: true })
          .eq("id", t.id)
          .is("category_id", null)
          .eq("is_manual_category", false);
        if (!error) applied++;
      } else {
        applied++;
      }
    }
    console.log(`  batch ${i / BATCH + 1}/${Math.ceil(work.length / BATCH)} done (${Math.min(i + BATCH, work.length)}/${work.length})`);
  }

  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}=${applied}  below-threshold=${lowconf}  unresolved-name=${unresolved}`);
  console.log("by category:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(3)}  ${k}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
