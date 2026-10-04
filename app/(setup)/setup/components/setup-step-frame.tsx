import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SetupStepProgress } from "@/lib/setup/setup-steps";

import { markSetupStepSkippedAction } from "../actions";

const STATUS_BADGE: Record<SetupStepProgress["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  DONE: { label: "Done", variant: "default" },
  SKIPPED: { label: "Skipped for now", variant: "secondary" },
  NOT_STARTED: { label: "Not started", variant: "outline" },
};

/** One step: what it is, what you get, the one thing to do, and a plain "Do this later". */
export function SetupStepFrame({
  step,
  notice,
  children,
}: {
  step: SetupStepProgress;
  notice?: string;
  /** Step-specific content, such as the channels step's connector cards. */
  children?: ReactNode;
}) {
  const badge = STATUS_BADGE[step.status];

  return (
    <Card className="gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{step.title}</h1>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{step.benefit}</p>

      {notice === "save_failed" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t save that. Please try again.
        </p>
      )}

      {children}

      <div className="flex flex-wrap items-center gap-3">
        {!children && step.hrefLabel && step.status !== "DONE" && <Button render={<Link href={step.href} />}>{step.hrefLabel}</Button>}
        {!children && step.status === "DONE" && step.hrefLabel && (
          <Button variant="outline" render={<Link href={step.href} />}>
            {step.hrefLabel}
          </Button>
        )}
        {step.status !== "DONE" && (
          <form action={markSetupStepSkippedAction}>
            <input type="hidden" name="stepId" value={step.id} />
            <Button type="submit" variant="link">
              Do this later
            </Button>
          </form>
        )}
      </div>

      {step.status !== "DONE" && <p className="text-xs text-muted-foreground">{step.waitingCost}</p>}
    </Card>
  );
}
