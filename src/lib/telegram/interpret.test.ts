import { describe, it, expect, vi } from "vitest";
import { parseToolInput, interpret } from "@/lib/telegram/interpret";

describe("parseToolInput", () => {
  it("parses set_budget_target", () => {
    expect(parseToolInput({ action: "set_budget_target", category: "Groceries", monthlyTarget: 1800 }))
      .toEqual({ kind: "set_budget_target", category: "Groceries", monthlyTarget: 1800 });
  });
  it("parses recategorise", () => {
    expect(parseToolInput({ action: "recategorise", txnHint: "the $43 Countdown charge", categoryName: "Pets" }))
      .toEqual({ kind: "recategorise", txnHint: "the $43 Countdown charge", categoryName: "Pets" });
  });
  it("parses accept_suggestions", () => {
    expect(parseToolInput({ action: "accept_suggestions", category: "Pets" }))
      .toEqual({ kind: "accept_suggestions", category: "Pets" });
  });
  it("parses a read_query with nested kind", () => {
    expect(parseToolInput({ action: "read_query", readKind: "budget_status", category: "Dining" }))
      .toEqual({ kind: "read_query", query: { kind: "budget_status", category: "Dining" } });
  });
  it("parses a bare read_query", () => {
    expect(parseToolInput({ action: "read_query", readKind: "net_worth" }))
      .toEqual({ kind: "read_query", query: { kind: "net_worth" } });
  });
  it("falls back to clarify on missing fields", () => {
    expect(parseToolInput({ action: "set_budget_target", category: "Groceries" }).kind).toBe("clarify");
    expect(parseToolInput({ action: "read_query" }).kind).toBe("clarify");
    expect(parseToolInput({ action: "garbage" }).kind).toBe("clarify");
  });
  it("passes through an explicit clarify", () => {
    expect(parseToolInput({ action: "clarify", question: "Which Spotify?" }))
      .toEqual({ kind: "clarify", question: "Which Spotify?" });
  });
});

describe("interpret", () => {
  it("extracts the tool_use input and parses it", async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "propose_action", input: { action: "read_query", readKind: "subscriptions" } }],
    }) } };
    const r = await interpret("what am I subscribed to?", client as any);
    expect(r).toEqual({ kind: "read_query", query: { kind: "subscriptions" } });
  });
  it("clarifies when the model returns no tool_use", async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "hi" }] }) } };
    expect((await interpret("hello", client as any)).kind).toBe("clarify");
  });
});
