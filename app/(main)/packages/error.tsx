"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function PackagesError({
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
        <h2 className="text-lg font-semibold text-foreground">
          Could not load the packages catalogue
        </h2>
        <p className="text-sm text-muted-foreground">
          {error.message || "Something went wrong while fetching the packages list."}
        </p>
        <Button onClick={reset} variant="secondary" className="mt-2">
          <RotateCw className="size-3.5" /> Try again
        </Button>
      </Card>
    </div>
  );
}
