import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("response schema artifact", () => {
  it("matches a fresh generator run", () => {
    const committed = readFileSync(
      "src/lib/api/openapi/responses.generated.json",
      "utf8",
    );
    const fresh = execSync(
      "npx ts-json-schema-generator --path src/lib/api/responses.ts --tsconfig tsconfig.json --type '*' --expose export --jsDoc extended",
      { encoding: "utf8" },
    );
    expect(JSON.parse(fresh)).toEqual(JSON.parse(committed));
  });
});
