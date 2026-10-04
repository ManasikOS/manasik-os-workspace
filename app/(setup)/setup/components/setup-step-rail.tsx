import Link from "next/link";
import { Circle, CircleCheck, SkipForward } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { SetupProgress, SetupStepStatus } from "@/lib/setup/setup-steps";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<SetupStepStatus, string> = {
  DONE: "Done",
  SKIPPED: "Skipped",
  NOT_STARTED: "Not started",
};

function SetupStepStatusIcon({ status }: { status: SetupStepStatus }) {
  if (status === "DONE") return <CircleCheck className={cn("size-4 shrink-0", TONE_TEXT.success)} aria-hidden />;
  if (status === "SKIPPED") return <SkipForward className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  return <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * The step list beside (or, on a phone, above) the current step. Any step can
 * be opened at any time. Status is always written out as well as shown by
 * icon, and the open step carries `aria-current="step"`.
 */
export function SetupStepRail({ progress, activeStepId }: { progress: SetupProgress; activeStepId: string | undefined }) {
  return (
    <nav aria-label="Setup steps" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {progress.doneCount} of {progress.total} done
        </p>
        <Progress value={(progress.doneCount / progress.total) * 100} aria-label="Setup progress" />
      </div>
      <ol className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
        {progress.steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          return (
            <li key={step.id} className="shrink-0 md:shrink">
              <Link
                href={`/setup?step=${step.id}`}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isActive ? "border-primary/40 bg-primary/5 text-foreground" : "border-transparent hover:bg-muted/50",
                )}
              >
                <SetupStepStatusIcon status={step.status} />
                <span className="flex flex-col">
                  <span className="font-medium">
                    {index + 1}. {step.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{STATUS_LABEL[step.status]}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
