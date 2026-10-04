"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Generic `error.tsx` boundary, parameterised per route by `sectionLabel`.
 * `app/(main)/management/settings/error.tsx` and its siblings are bespoke,
 * page-specific versions of this same shape — this covers every route group
 * that previously had no boundary at all, so a thrown Supabase error inside
 * one section no longer takes down the rest of the app.
 */
export function createRouteErrorBoundary(sectionLabel: string) {
  return function RouteError({
    error,
    reset,
  }: {
    error: Error & { digest?: string };
    reset: () => void;
  }) {
    useEffect(() => {
      console.error(error);
      Sentry.captureException(error, { tags: { boundary: sectionLabel } });
    }, [error]);

    return (
      <div className="flex w-full items-center justify-center py-20">
        <Card className="flex flex-col items-center gap-3 p-10 max-w-md text-center">
          <div className="size-11 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertTriangle className="size-5" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Could not load {sectionLabel}
          </h2>
          <p className="text-sm text-muted-foreground">
            {error.message || `Something went wrong while loading ${sectionLabel}.`}
          </p>
          <Button onClick={reset} variant="secondary" className="mt-2">
            <RotateCw className="size-3.5" /> Try again
          </Button>
        </Card>
      </div>
    );
  };
}
