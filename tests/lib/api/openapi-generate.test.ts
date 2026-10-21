import { describe, it, expect } from "vitest";
import { generateOpenApi } from "@/lib/api/openapi/generate";
import { registry } from "@/lib/api/openapi/registry";

describe("generateOpenApi", () => {
  const doc = generateOpenApi();

  it("is an OpenAPI 3.1 document", () => {
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
  });

  it("has a path entry for every registry route", () => {
    for (const r of registry) {
      const m = r.method.toLowerCase();
      const pathItem = doc.paths[r.path] as Record<string, unknown> | undefined;
      expect(pathItem?.[m]).toBeDefined();
    }
  });

  it("every responseType resolves to a component schema", () => {
    for (const r of registry) {
      expect(doc.components.schemas[r.responseType]).toBeDefined();
    }
  });

  it("declares the bearerAuth security scheme", () => {
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it("budgets response exposes the position tree", () => {
    const s = JSON.stringify(doc.components.schemas);
    expect(s).toContain("position");
    expect(s).toContain("expenses");
  });
});
