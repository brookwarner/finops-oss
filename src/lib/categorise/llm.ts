// src/lib/categorise/llm.ts
//
// LLM fallback layer. Runs only in the nightly cron against transactions still
// uncategorised after the deterministic layers. One batched Claude Haiku call
// returns {merchant, category_name, confidence} per txn; high-confidence rows
// resolve to a category_id and are written with needs_review = true and cached
// as a source='llm' rule. Below threshold / unresolvable rows stay in the inbox.

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export const LLM_MODEL = "claude-haiku-4-5-20251001";
export const CONFIDENCE_THRESHOLD = 0.75;

export type LlmTxn = {
  id: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  account_type: string | null;
};

export type LlmCategory = { id: string; name: string; group: string | null; kind: string | null };

export type RawSuggestion = { id: string; category_name: string; confidence: number };

export type Resolution = { id: string; category_id: string; confidence: number };

/**
 * Pure: turn raw model suggestions into applicable resolutions. Drops rows
 * below the confidence threshold or whose category_name does not resolve to a
 * real category. Case-insensitive, trimmed name match.
 */
export function resolveLLMSuggestions(
  raw: RawSuggestion[],
  categories: LlmCategory[],
  threshold: number = CONFIDENCE_THRESHOLD,
): Resolution[] {
  const idByName = new Map(categories.map((c) => [c.name.toLowerCase().trim(), c.id]));
  const out: Resolution[] = [];
  for (const s of raw) {
    if (typeof s.confidence !== "number" || s.confidence < threshold) continue;
    const id = idByName.get((s.category_name ?? "").toLowerCase().trim());
    if (!id) continue;
    out.push({ id: s.id, category_id: id, confidence: s.confidence });
  }
  return out;
}

function buildPrompt(txns: LlmTxn[], categories: LlmCategory[]): string {
  const taxonomy = categories
    .map((c) => `- ${c.name} (group: ${c.group ?? "—"}, kind: ${c.kind ?? "—"})`)
    .join("\n");
  const items = txns
    .map((t) =>
      JSON.stringify({
        id: t.id,
        merchant: t.merchant,
        description: t.description,
        amount: t.amount,
        account_type: t.account_type,
      }),
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

/**
 * Calls Claude once for the whole batch and parses the JSON array. Returns []
 * on any parse/transport failure (caller treats that as "no suggestions").
 */
export async function getLLMSuggestions(
  txns: LlmTxn[],
  categories: LlmCategory[],
  client: Anthropic,
): Promise<RawSuggestion[]> {
  if (txns.length === 0) return [];
  const msg = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(txns, categories) }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    // 1. Try fenced ```json ... ``` block (model sometimes wraps output).
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      const parsed = JSON.parse(fenced[1].trim()) as RawSuggestion[];
      if (Array.isArray(parsed)) return parsed;
    }
    // 2. Try parsing the whole text as a JSON array.
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed) as RawSuggestion[];
      if (Array.isArray(parsed)) return parsed;
    }
    // 3. Fall back to the original substring slice between outermost [ and ].
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) {
      console.error("[llm] no JSON array in Claude response");
      return [];
    }
    const parsed = JSON.parse(text.slice(start, end + 1)) as RawSuggestion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[llm] failed to parse Claude response", err);
    return [];
  }
}

/** Build an Anthropic client, or null if no API key is configured. */
export function buildAnthropicClient(): Anthropic | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
}
