import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SetupProgress } from "@/lib/setup/setup-steps";

/** The end of the list. Not a gate: it summarises and offers the dashboard. */
export function SetupFinishPanel({ progress }: { progress: SetupProgress }) {
  const nextOpen = progress.steps.find((step) => step.id === progress.nextOpenStepId);

  return (
    <Card className="gap-4 p-6">
      <h1 className="text-lg font-semibold text-foreground">
        {progress.allDone ? "Your workspace is ready" : "You can finish the rest any time"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {progress.doneCount} of {progress.total} steps done.
        {nextOpen ? ` Next up: ${nextOpen.title}. You'll find the setup guide on your dashboard.` : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button render={<Link href="/dashboard" />}>Go to dashboard</Button>
        {nextOpen && (
          <Button variant="outline" render={<Link href={`/setup?step=${nextOpen.id}`} />}>
            Continue with {nextOpen.title}
          </Button>
        )}
      </div>
    </Card>
  );
}
