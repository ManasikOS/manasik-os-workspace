import Link from "next/link";

import { dismissSetupGuideAction } from "@/app/(setup)/setup/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { capabilitiesForSetup } from "@/lib/access/setup-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadSetupProgress } from "@/lib/setup/setup-progress";

/**
 * The dashboard's nudge to finish setting up (docs/onboarding/plan.md §5.4).
 * Administrator only. Renders nothing once every step is done or the guide was
 * dismissed; "Setup guide" in Settings always reopens it.
 */
export default async function SetupGuideCard() {
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForSetup(role).viewSetup) return null;

  const progress = await loadSetupProgress();
  if (progress.allDone || progress.guideDismissed) return null;

  const next = progress.steps.find((step) => step.id === progress.nextOpenStepId);

  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Finish setting up your workspace</p>
          <p className="text-xs text-muted-foreground">
            {progress.doneCount} of {progress.total} steps done
            {next ? `. Next: ${next.title}.` : "."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" render={<Link href={next ? `/setup?step=${next.id}` : "/setup"} />}>
            Continue setup
          </Button>
          <form action={dismissSetupGuideAction}>
            <Button type="submit" size="sm" variant="ghost">
              Dismiss
            </Button>
          </form>
        </div>
      </div>
      <Progress value={(progress.doneCount / progress.total) * 100} aria-label="Setup progress" />
    </Card>
  );
}
