// src/lib/categorise/llm.test.ts
import { describe, it, expect } from "vitest";
import { resolveLLMSuggestions, getLLMSuggestions, type LlmCategory } from "@/lib/categorise/llm";
import type Anthropic from "@anthropic-ai/sdk";

const categories: LlmCategory[] = [
  { id: "cat-groceries", name: "Groceries", group: "Food", kind: "monthly_cap" },
  { id: "cat-fuel", name: "Gasoline/Fuel", group: "Transit", kind: "monthly_cap" },
];

describe("resolveLLMSuggestions", () => {
  it("resolves a high-confidence, valid category", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "Groceries", confidence: 0.9 }],
      categories,
    );
    expect(out).toEqual([{ id: "t1", category_id: "cat-groceries", confidence: 0.9 }]);
  });

  it("drops below-threshold suggestions", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "Groceries", confidence: 0.5 }],
      categories,
    );
    expect(out).toEqual([]);
  });

  it("drops unresolvable category names", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "Not A Category", confidence: 0.99 }],
      categories,
    );
    expect(out).toEqual([]);
  });

  it("matches category names case-insensitively and trimmed", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "  groceries ", confidence: 0.8 }],
      categories,
    );
    expect(out[0]?.category_id).toBe("cat-groceries");
  });

  it("respects a custom threshold", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "Groceries", confidence: 0.6 }],
      categories,
      0.5,
    );
    expect(out).toHaveLength(1);
  });

  it("accepts a suggestion exactly at the threshold", () => {
    const out = resolveLLMSuggestions(
      [{ id: "t1", category_name: "Groceries", confidence: 0.75 }],
      categories,
    );
    expect(out).toHaveLength(1);
  });
});

describe("getLLMSuggestions", () => {
  it("returns [] for empty input without calling the client", async () => {
    let called = false;
    const stub = { messages: { create: async () => { called = true; return { content: [] }; } } } as unknown as Anthropic;
    const out = await getLLMSuggestions([], categories, stub);
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});
