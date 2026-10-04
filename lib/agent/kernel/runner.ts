/**
 * The one Anthropic client every agent shares — model id, lazy singleton,
 * and the `isAiConfigured()` gate.
 *
 * Moved to `lib/ai/provider.ts` in Phase 0 (P0.1) — this file now only
 * re-exports, so nothing importing `getClient`/`isAiConfigured`/`MODEL_ID`
 * from this path breaks. New code should import from `lib/ai/provider.ts`
 * directly, and use `generateStructured()` there for anything that isn't a
 * multi-turn tool-calling agent loop.
 */

export { MODEL_ID, isAiConfigured, getClient } from "@/lib/ai/provider";
