import Link from "next/link";
import { after } from "next/server";

import { Button } from "@/components/ui/button";
import { SETUP_CONNECTOR_COPY } from "@/lib/setup/connector-copy";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { recordOnboardingEvent } from "@/lib/setup/setup-events-server";
import { loadSetupProgress } from "@/lib/setup/setup-progress";
import { setupStepViewSchema } from "@/lib/validations/setup";

import { SetupFinishPanel } from "./components/setup-finish-panel";
import { SetupStepBody } from "./components/setup-step-body";
import { SetupStepFrame } from "./components/setup-step-frame";
import { SetupStepRail } from "./components/setup-step-rail";

/** Steps with their own content; the first-package step just links to the Packages flow. */
const STEPS_WITH_BODY = new Set(["account", "agency", "team", "channels", "payments"]);

const CONNECTOR_TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(SETUP_CONNECTOR_COPY).map(([key, copy]) => [key, copy.title]),
);

type SetupPageProps = {
  searchParams: Promise<{ step?: string; notice?: string; connected?: string; connector_error?: string; message?: string }>;
};

/**
 * The guided setup. Nothing here is required: every step can be skipped,
 * revisited or opened out of order, and the dashboard is never gated on it
 * (docs/onboarding/plan.md §5). The administrator gate lives in the layout.
 */
export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { step, notice, connected, connector_error: connectorError, message } = await searchParams;
  const progress = await loadSetupProgress();

  const requested = setupStepViewSchema.parse(step);
  const activeId = requested ?? progress.nextOpenStepId ?? "finish";
  const activeStep = progress.steps.find((candidate) => candidate.id === activeId);

  // Funnel: which step was opened. Off the critical path; repeat views of the same step count once per agency in the summary.
  const { agencyId } = await getCurrentStaffRole();
  if (agencyId && activeStep) {
    after(() => recordOnboardingEvent({ agencyId, event: "STEP_VIEWED", step: activeStep.id }));
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 pr-12">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-muted-foreground">Welcome</p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Set up your workspace</h2>
        </div>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          Go to dashboard
        </Button>
      </header>

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <SetupStepRail progress={progress} activeStepId={activeStep?.id} />
        <div className="flex flex-col gap-4">
          {connected && CONNECTOR_TITLES[connected] && (
            <p role="status" className="rounded-md border bg-card px-4 py-3 text-sm text-foreground">
              {CONNECTOR_TITLES[connected]} is connected.
            </p>
          )}
          {connectorError && CONNECTOR_TITLES[connectorError] && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
              We couldn&apos;t connect {CONNECTOR_TITLES[connectorError]}. {message ? message.slice(0, 200) : "Please try again."} You can
              also do this later.
            </p>
          )}
          {activeStep ? (
            <SetupStepFrame step={activeStep} notice={notice}>
              {STEPS_WITH_BODY.has(activeStep.id) ? <SetupStepBody stepId={activeStep.id} progress={progress} /> : null}
            </SetupStepFrame>
          ) : (
            <SetupFinishPanel progress={progress} />
          )}
        </div>
      </div>
    </>
  );
}
