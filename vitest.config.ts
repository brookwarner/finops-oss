import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Match Next's automatic JSX runtime so component render tests work without an
  // explicit `import React` (the App Router never needs one).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "cli/**/*.test.mjs"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
