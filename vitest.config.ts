import { defineConfig } from "vitest/config";

// Pure logic only (see AGENTS.md): every *.test.ts sits beside the module it
// specifies. The exclude matters — `next build` copies lib/ into
// .next/standalone, tests and all, so without it the suite silently runs a
// stale duplicate of every test against the last build instead of the working
// tree.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
