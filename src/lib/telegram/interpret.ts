import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LLM_MODEL } from "@/lib/categorise/llm";
import type { Interpretation, ReadQuery } from "./types";

const READ_KINDS = ["budgets", "budget_status", "subscriptions", "net_worth", "forecast", "recent"] as const;

const toolInputSchema = z.object({
  action: z.enum(["set_budget_target", "recategorise", "accept_suggestions", "read_query", "clarify"]),
  category: z.string().optional(),
  monthlyTarget: z.number().optional(),
  txnHint: z.string().optional(),
  categoryName: z.string().optional(),
  readKind: z.enum(READ_KINDS).optional(),
  limit: z.number().optional(),
  question: z.string().optional(),
});

function clarify(question = "I didn't catch that — try rephrasing. I can change budgets, recategorise a transaction, accept inbox suggestions, or answer questions."): Interpretation {
  return { kind: "clarify", question };
}

/** Pure: validate the model's flat tool input into a typed Interpretation. */
export function parseToolInput(raw: unknown): Interpretation {
  const p = toolInputSchema.safeParse(raw);
  if (!p.success) return clarify();
  const d = p.data;
  switch (d.action) {
    case "set_budget_target":
      return d.category && typeof d.monthlyTarget === "number"
        ? { kind: "set_budget_target", category: d.category, monthlyTarget: d.monthlyTarget }
        : clarify();
    case "recategorise":
      return d.txnHint && d.categoryName
        ? { kind: "recategorise", txnHint: d.txnHint, categoryName: d.categoryName }
        : clarify();
    case "accept_suggestions":
      return d.category ? { kind: "accept_suggestions", category: d.category } : clarify();
    case "read_query": {
      if (!d.readKind) return clarify();
      let query: ReadQuery;
      if (d.readKind === "budget_status") {
        if (!d.category) return clarify();
        query = { kind: "budget_status", category: d.category };
      } else if (d.readKind === "recent") {
        const limit = typeof d.limit === "number" ? Math.min(Math.max(1, Math.floor(d.limit)), 50) : undefined;
        query = { kind: "recent", category: d.category, limit };
      } else {
        query = { kind: d.readKind };
      }
      return { kind: "read_query", query };
    }
    case "clarify":
      return clarify(d.question);
  }
}

const SYSTEM = [
  "You translate a single Telegram message from the FinOps owner into exactly one structured action by calling the propose_action tool.",
  "You never perform actions yourself — you only propose one. Allowed actions:",
  "- set_budget_target (category, monthlyTarget) — change a budget cap.",
  "- recategorise (txnHint describing which transaction, categoryName) — move a transaction to a category.",
  "- accept_suggestions (category) — accept pending inbox suggestions for a category.",
  "- read_query (readKind: budgets|budget_status|subscriptions|net_worth|forecast|recent, plus category for budget_status/recent) — answer a question.",
  "- clarify (question) — if the request is ambiguous, unsupported, or anything involving moving money / payments / transfers.",
  "Always call propose_action exactly once. Never invent categories — pass the user's words through; the server resolves them.",
].join("\n");

const TOOL: Anthropic.Tool = {
  name: "propose_action",
  description: "Propose exactly one action for the user's message.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["set_budget_target", "recategorise", "accept_suggestions", "read_query", "clarify"] },
      category: { type: "string" },
      monthlyTarget: { type: "number" },
      txnHint: { type: "string" },
      categoryName: { type: "string" },
      readKind: { type: "string", enum: [...READ_KINDS] },
      limit: { type: "number" },
      question: { type: "string" },
    },
    required: ["action"],
  },
};

/** Call the model (forced tool-use) and parse the proposal. Clarify on any failure. */
export async function interpret(text: string, client: Anthropic): Promise<Interpretation> {
  try {
    const msg = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 512,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "propose_action" },
      messages: [{ role: "user", content: text }],
    });
    const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) return clarify();
    return parseToolInput(block.input);
  } catch {
    return clarify("Sorry — I couldn't process that just now. Try again in a moment.");
  }
}
