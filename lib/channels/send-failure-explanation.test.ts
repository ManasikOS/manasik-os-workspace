import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { explainSendFailure } = await import("./send-failure-explanation");
const { MetaGraphError } = await import("@/lib/meta/graph");

const metaError = (message: string, extra: Record<string, unknown> = {}) => new MetaGraphError("wrapped", 400, { error: { message, code: 10, ...extra } });

describe("explainSendFailure", () => {
  it("says what to do when the app is in Development mode and the customer has no role on it — the first-test failure", () => {
    const text = explainSendFailure(
      metaError("Cannot message users who are not admins, developers or testers of the app until pages_messaging permission is reviewed and the app is live."),
      "UNKNOWN",
    );
    expect(text).toContain("App roles → Testers");
    expect(text).toContain("Development mode");
  });

  it("explains a closed reply window without blaming the connection", () => {
    expect(explainSendFailure(metaError("Outside allowed window"), "OUTSIDE_SERVICE_WINDOW")).toContain("24 hours");
  });

  it("passes on Meta's own words for anything else, shortened", () => {
    expect(explainSendFailure(metaError("Some other Meta problem"), "UNKNOWN")).toBe("Meta said: Some other Meta problem");
    expect(explainSendFailure(metaError("x".repeat(500)), "UNKNOWN").length).toBeLessThan(230);
  });

  it("falls back to a fixed sentence for an error with no Meta explanation, and never repeats a plain error's text", () => {
    expect(explainSendFailure(new Error("secret internal detail EAAB123"), "UNKNOWN")).not.toContain("EAAB123");
    expect(explainSendFailure(new MetaGraphError("x", 500, null), "UNKNOWN")).toContain("Settings → Integrations");
  });
});
