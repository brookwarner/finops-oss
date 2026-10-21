import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tailwind = createRequire(require.resolve("tailwindcss"));
const chokidar = createRequire(tailwind.resolve("chokidar"));
const fastGlob = createRequire(tailwind.resolve("fast-glob"));
const micromatch = createRequire(fastGlob.resolve("micromatch"));

for (const [consumer, braces] of [["chokidar", chokidar("braces")], ["micromatch", micromatch("braces")]] as const) {
  describe(`${consumer}'s installed braces patch`, () => {
    it("rejects deeply nested braces, parentheses and mixed groups before recursive walkers run", () => {
      for (const pattern of ["{".repeat(4000) + "a,b" + "}".repeat(4000),
        "(".repeat(4000) + "a" + ")".repeat(4000), "{(".repeat(2000) + "a,b" + ")}".repeat(2000),
        "{".repeat(4000), "{".repeat(101) + "a,b" + "}".repeat(101)]) {
        for (const operation of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
          expect(() => operation(pattern)).toThrow("Input nesting exceeds maximum depth (100)");
        }
      }
    });

    it("preserves normal glob expansion, bounded nesting and long shallow patterns", () => {
      expect(braces.expand("src/{app,components}/**/*.{ts,tsx}")).toEqual([
        "src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx",
      ]);
      expect(braces.compile("a/{b,c}")).toBe("a/(b|c)");
      expect(() => braces.compile("{".repeat(100) + "a,b" + "}".repeat(100))).not.toThrow();
      expect(() => braces.compile("{a,b}".repeat(1000))).not.toThrow();
      expect(() => braces.parse('"' + "{".repeat(200) + '"')).not.toThrow();
      expect(() => braces.parse("[" + "{".repeat(200) + "]")).not.toThrow();
      expect(() => braces.parse("\\{".repeat(200))).not.toThrow();
    });
  });
}
