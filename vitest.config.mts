import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for the app's pure-logic unit tests (validation, mappers,
 * client-side list helpers, CSV/XLSX encoding). No React Testing Library /
 * jsdom environment yet — every test suite added so far exercises plain
 * functions, not components, so the default `node` environment is enough.
 * Server Actions, Supabase-backed repository reads, and anything behind
 * `"use server"` are out of scope for this runner; they need a real or
 * emulated database (see docs/modules/packages-production-readiness-plan.md, Phase 5
 * item 1's own scoping note).
 */
export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
      // Next.js's bundler resolves `import "server-only"` specially; it is not an installed package (see
      // worker/server-only-stub.ts for the same problem in the worker build), so Vitest needs its own stub.
      "server-only": path.resolve(dirname, "worker/server-only-stub.ts"),
    },
  },
});
