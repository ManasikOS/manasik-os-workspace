"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex w-full items-center justify-center py-20">
      <Card className="flex flex-col items-center gap-3 p-10 max-w-md text-center">
        <div className="size-11 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertTriangle className="size-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Could not load the team directory</h2>
        <p className="text-sm text-muted-foreground">
          {/* Never render error.message here — a TeamPersistenceError's message
              embeds the table and operation that failed (and sometimes the raw
              Postgres error text), which has no business reaching the browser.
              The real detail is already in the console.error() above, which a
              server-side log aggregator captures. See §5 of
              docs/modules/team-module-remediation-plan.md. */}
          Something went wrong while fetching the team list.
        </p>
        <Button onClick={reset} variant="secondary" className="mt-2">
          <RotateCw className="size-3.5" /> Try again
        </Button>
      </Card>
    </div>
  );
}
