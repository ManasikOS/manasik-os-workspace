import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireUser = vi.fn();
const getCurrentDepartureCapabilities = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentDepartureCapabilities: () => getCurrentDepartureCapabilities(),
}));

import { runDepartureAction } from "./departure-action";

const schema = z.object({ name: z.string().min(3, { error: "Name is too short." }) });
const config = { capability: "manageTasks" as const, denied: "Your role cannot manage tasks.", schema };

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  getCurrentDepartureCapabilities.mockReset().mockResolvedValue({ manageTasks: true });
});

describe("runDepartureAction", () => {
  it("signs the caller in before anything else, and stops if that fails", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const handler = vi.fn();
    await expect(runDepartureAction(config, { name: "Task" }, handler)).rejects.toThrow("NEXT_REDIRECT");
    expect(getCurrentDepartureCapabilities).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a caller without the capability, before looking at the payload", async () => {
    getCurrentDepartureCapabilities.mockResolvedValue({ manageTasks: false });
    const handler = vi.fn();
    const result = await runDepartureAction(config, { not: "valid" }, handler);
    expect(result).toEqual({ ok: false, error: "Your role cannot manage tasks." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns field errors for an invalid payload and never calls the handler", async () => {
    const handler = vi.fn();
    const result = await runDepartureAction(config, { name: "x" }, handler);
    expect(result).toMatchObject({ ok: false, error: "Check the highlighted fields and try again." });
    expect((result as { fieldErrors?: Record<string, string[]> }).fieldErrors?.name).toEqual(["Name is too short."]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("can word the invalid-payload message itself", async () => {
    const result = await runDepartureAction(
      { ...config, invalidMessage: (error) => error.issues[0]?.message ?? "bad" },
      { name: "x" },
      vi.fn(),
    );
    expect(result).toMatchObject({ ok: false, error: "Name is too short." });
  });

  it("hands the handler the parsed payload, the user and the capabilities", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true, id: "t1" });
    const result = await runDepartureAction(config, { name: "  Confirm hotel  ".trim(), extra: "dropped" }, handler);
    expect(result).toEqual({ ok: true, id: "t1" });
    expect(handler).toHaveBeenCalledWith(
      { name: "Confirm hotel" },
      { user: { id: "user-1" }, capabilities: { manageTasks: true } },
    );
  });
});
