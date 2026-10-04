"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/tone-badge";

/** Gives staff a recoverable, non-technical Finance workspace failure state. */
export default function FinanceWorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="Finance could not load"
      description="Your Finance workspace data could not be loaded. Try again, or contact an administrator if the problem continues."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
