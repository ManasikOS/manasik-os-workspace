import { describe, expect, it } from "vitest";

import { createSingleFlightRunner } from "./single-flight-runner";

type Plan = { ids: string[]; newer: boolean };
const mergePlans = (left: Plan, right: Plan): Plan => ({ ids: [...new Set([...left.ids, ...right.ids])], newer: left.newer || right.newer });

/** A promise the test resolves by hand, to hold a run "in flight". */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

describe("createSingleFlightRunner", () => {
  it("runs the first plan immediately", async () => {
    const seen: Plan[] = [];
    const runner = createSingleFlightRunner(async (plan: Plan) => void seen.push(plan), mergePlans);
    runner.submit({ ids: ["a"], newer: false });
    await flush();
    expect(seen).toEqual([{ ids: ["a"], newer: false }]);
    expect(runner.busy()).toBe(false);
  });

  it("never runs two at once, and folds everything that arrives meanwhile into ONE follow-up that keeps every id", async () => {
    const gate = deferred();
    const seen: Plan[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const runner = createSingleFlightRunner(async (plan: Plan) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      seen.push(plan);
      if (seen.length === 1) await gate.promise;
      concurrent -= 1;
    }, mergePlans);

    runner.submit({ ids: ["a"], newer: false });
    runner.submit({ ids: ["b"], newer: false });
    runner.submit({ ids: ["c", "b"], newer: true });
    expect(runner.busy()).toBe(true);
    gate.resolve();
    await flush();
    await flush();

    expect(maxConcurrent).toBe(1);
    expect(seen).toEqual([
      { ids: ["a"], newer: false },
      { ids: ["b", "c"], newer: true },
    ]);
    expect(runner.busy()).toBe(false);
  });

  it("does not lose an id that was requested while an earlier read was still running", async () => {
    const gate = deferred();
    const requested = new Set<string>();
    let first = true;
    const runner = createSingleFlightRunner(async (plan: Plan) => {
      plan.ids.forEach((id) => requested.add(id));
      if (first) {
        first = false;
        await gate.promise;
      }
    }, mergePlans);
    runner.submit({ ids: ["x"], newer: false });
    runner.submit({ ids: ["y"], newer: false });
    gate.resolve();
    await flush();
    await flush();
    expect([...requested].sort()).toEqual(["x", "y"]);
  });

  it("cancelQueued drops the follow-up but lets the running read finish", async () => {
    const gate = deferred();
    const seen: string[] = [];
    const runner = createSingleFlightRunner(async (plan: Plan) => {
      seen.push(...plan.ids);
      await gate.promise;
    }, mergePlans);
    runner.submit({ ids: ["a"], newer: false });
    runner.submit({ ids: ["b"], newer: false });
    runner.cancelQueued();
    gate.resolve();
    await flush();
    expect(seen).toEqual(["a"]);
    expect(runner.busy()).toBe(false);
  });

  it("keeps running after a failure and reports it, so one bad read cannot wedge synchronisation", async () => {
    const errors: unknown[] = [];
    const seen: Plan[] = [];
    let call = 0;
    const runner = createSingleFlightRunner(
      async (plan: Plan) => {
        call += 1;
        if (call === 1) throw new Error("network");
        seen.push(plan);
      },
      mergePlans,
      (cause) => errors.push(cause),
    );
    runner.submit({ ids: ["a"], newer: false });
    await flush();
    runner.submit({ ids: ["b"], newer: false });
    await flush();
    expect(errors).toHaveLength(1);
    expect(seen).toEqual([{ ids: ["b"], newer: false }]);
    expect(runner.busy()).toBe(false);
  });
});
