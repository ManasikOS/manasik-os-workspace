import { describe, expect, it } from "vitest";

import {
  SETUP_STEP_IDS,
  deriveSetupProgress,
  withSetupStepSkipped,
  type SetupFacts,
  type SetupStateRow,
} from "./setup-steps";

const noFacts: SetupFacts = {
  activeStaffCount: 1,
  channelConnected: false,
  paymentAccountCount: 0,
  packageCount: 0,
};
const emptyState: SetupStateRow = {
  steps: {},
  basicsConfirmedAt: null,
  passwordSetAt: null,
  guideDismissedAt: null,
  lastStep: null,
};

const statusOf = (progress: ReturnType<typeof deriveSetupProgress>, id: string) =>
  progress.steps.find((step) => step.id === id)?.status;

describe("deriveSetupProgress", () => {
  it("lists the six steps in order, all not started for a brand-new agency", () => {
    const progress = deriveSetupProgress(noFacts, emptyState);
    expect(progress.steps.map((s) => s.id)).toEqual([...SETUP_STEP_IDS]);
    expect(progress.steps.every((s) => s.status === "NOT_STARTED")).toBe(true);
    expect(progress.doneCount).toBe(0);
    expect(progress.total).toBe(6);
    expect(progress.nextOpenStepId).toBe("account");
    expect(progress.allDone).toBe(false);
  });

  it("derives done from live data, never from a click", () => {
    const progress = deriveSetupProgress(
      { activeStaffCount: 3, channelConnected: true, paymentAccountCount: 1, packageCount: 2 },
      { ...emptyState, basicsConfirmedAt: "2026-09-26T00:00:00Z", passwordSetAt: "2026-09-26T00:00:00Z" },
    );
    expect(progress.steps.every((s) => s.status === "DONE")).toBe(true);
    expect(progress.allDone).toBe(true);
    expect(progress.nextOpenStepId).toBeNull();
  });

  it("counts a team of one as not done and a second active member as done", () => {
    expect(statusOf(deriveSetupProgress(noFacts, emptyState), "team")).toBe("NOT_STARTED");
    expect(statusOf(deriveSetupProgress({ ...noFacts, activeStaffCount: 2 }, emptyState), "team")).toBe("DONE");
  });

  it("marks a skipped step as skipped, and keeps it open for the guide", () => {
    const progress = deriveSetupProgress(noFacts, { ...emptyState, steps: { team: "SKIPPED" } });
    expect(statusOf(progress, "team")).toBe("SKIPPED");
    expect(progress.doneCount).toBe(0);
    expect(progress.allDone).toBe(false);
  });

  it("lets real progress win over an earlier skip", () => {
    const progress = deriveSetupProgress({ ...noFacts, packageCount: 1 }, { ...emptyState, steps: { package: "SKIPPED" } });
    expect(statusOf(progress, "package")).toBe("DONE");
  });

  it("points the next open step at the first step that is neither done nor skipped, else the first skipped one", () => {
    const facts = { ...noFacts, activeStaffCount: 2 };
    const skippedFirst = deriveSetupProgress(facts, {
      ...emptyState,
      basicsConfirmedAt: "2026-09-26T00:00:00Z",
      steps: { account: "SKIPPED" },
    });
    expect(skippedFirst.nextOpenStepId).toBe("channels");

    const allSkippedOrDone = deriveSetupProgress(facts, {
      ...emptyState,
      basicsConfirmedAt: "2026-09-26T00:00:00Z",
      steps: { account: "SKIPPED", channels: "SKIPPED", payments: "SKIPPED", package: "SKIPPED" },
    });
    expect(allSkippedOrDone.nextOpenStepId).toBe("account");
  });

  it("reports whether the guide was dismissed", () => {
    expect(deriveSetupProgress(noFacts, emptyState).guideDismissed).toBe(false);
    expect(deriveSetupProgress(noFacts, { ...emptyState, guideDismissedAt: "2026-09-26T00:00:00Z" }).guideDismissed).toBe(true);
  });

  it("ignores unknown step ids stored in the state row", () => {
    const progress = deriveSetupProgress(noFacts, { ...emptyState, steps: { bogus: "SKIPPED" } });
    expect(progress.steps).toHaveLength(6);
  });
});

describe("withSetupStepSkipped", () => {
  it("adds a skip without disturbing other steps", () => {
    expect(withSetupStepSkipped({ team: "SKIPPED" }, "package")).toEqual({ team: "SKIPPED", package: "SKIPPED" });
  });

  it("does not mutate its input", () => {
    const original = { team: "SKIPPED" } as const;
    withSetupStepSkipped(original, "package");
    expect(original).toEqual({ team: "SKIPPED" });
  });
});
