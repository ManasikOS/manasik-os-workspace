import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithTiming(perfTiming: string | undefined) {
  vi.resetModules();
  if (perfTiming === undefined) delete process.env.PERF_TIMING;
  else process.env.PERF_TIMING = perfTiming;
  return (await import("@/lib/timing")).withTiming;
}

describe("withTiming", () => {
  afterEach(() => {
    delete process.env.PERF_TIMING;
    vi.restoreAllMocks();
  });

  it("returns the result and logs nothing when PERF_TIMING is off", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const withTiming = await loadWithTiming(undefined);
    await expect(withTiming("x", async () => 42)).resolves.toBe(42);
    expect(info).not.toHaveBeenCalled();
  });

  it("logs one [perf] line with the label when PERF_TIMING=1", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const withTiming = await loadWithTiming("1");
    await expect(withTiming("leads.loadData", async () => "ok")).resolves.toBe("ok");
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/^\[perf\] leads\.loadData \d+ms$/);
  });

  it("still logs and rethrows when the wrapped call fails", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const withTiming = await loadWithTiming("1");
    await expect(withTiming("boom", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(info).toHaveBeenCalledTimes(1);
  });
});
