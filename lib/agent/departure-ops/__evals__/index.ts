/**
 * Run before every prompt or tool change (§13 of
 * docs/modules/departure-operations-agent-implementation-plan.md). Not wired to a
 * test runner — this repository has none configured (no jest/vitest in
 * package.json) — so there is currently no `npm run` entry that executes
 * this. `runEvalSuite(GOLDEN_SET)` is a plain function; wiring it up is one
 * `vitest.config.ts` plus an SVG-string transform away (the only reason
 * this couldn't be exercised directly via `tsx` during development: this
 * module's import chain reaches `lib/data/departure-groups.ts`, which
 * pulls in a `.svg` asset import Next's own bundler handles and nothing
 * outside Next does).
 */

export { GOLDEN_SET } from "./scenarios";
export { runEvalCheck, runEvalSuite, type EvalCheck, type EvalResult } from "./check";
export { buildScenarioStore } from "./fixtures";
