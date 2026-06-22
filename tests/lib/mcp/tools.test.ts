import { describe, it, expect } from "vitest";
import { allTools } from "@/lib/mcp/tools";
import { wrapTool, type ToolDef } from "@/lib/mcp/tools/types";

const EXPECTED_TOOL_NAMES = [
  "ping",
  "list_budgets",
  "get_budget_status",
  "get_budget_history",
  "get_daily_burn",
  "set_budget_target",
  "get_recent_transactions",
  "search_transactions",
  "categorise_transactions",
  "apply_similar",
  "accept_suggestions",
  "get_net_worth",
  "get_holdings",
  "get_cashflow_forecast",
  "get_mortgage_pi",
  "simulate_mortgage_scenario",
  "get_subscriptions",
  "get_fi",
  "simulate_repayment_fi",
  "get_emergency_fund",
  "get_income_history",
  "simulate_cashflow",
  "submit_monthly_review",
  "list_manual_assets",
  "set_manual_asset",
  "remove_manual_asset",
];

describe("allTools registry", () => {
  it("registers every expected tool name", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("has unique tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a description and a schema object", () => {
    for (const t of allTools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.schema).toBe("object");
    }
  });
});

describe("wrapTool", () => {
  function makeTool(handler: ToolDef["handler"]): ToolDef {
    return { name: "x", description: "d", schema: {}, handler };
  }

  it("passes through a successful result unchanged", async () => {
    const wrapped = wrapTool(makeTool(async () => ({ content: [{ type: "text", text: "ok" }] })));
    const r = await wrapped.handler({}, {});
    expect(r).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("converts a thrown Error into a structured { error } text block", async () => {
    const wrapped = wrapTool(makeTool(async () => { throw new Error("kaboom"); }));
    const r = await wrapped.handler({}, {});
    expect(JSON.parse(r.content[0].text)).toEqual({ error: "kaboom" });
  });

  it("stringifies a non-Error throw", async () => {
    const wrapped = wrapTool(makeTool(async () => { throw "weird"; }));
    const r = await wrapped.handler({}, {});
    expect(JSON.parse(r.content[0].text)).toEqual({ error: "weird" });
  });

  it("preserves the name, description and schema", () => {
    const t = makeTool(async () => ({ content: [{ type: "text", text: "" }] }));
    const wrapped = wrapTool(t);
    expect(wrapped.name).toBe(t.name);
    expect(wrapped.description).toBe(t.description);
    expect(wrapped.schema).toBe(t.schema);
  });
});
