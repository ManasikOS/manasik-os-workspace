"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { ArchiveRestore, Eye, Loader2, PackageOpen } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import type { PackageListItem } from "@/lib/types/packages";
import { restorePackageAction } from "../actions";
import { JourneyTypeBadge, PackageStatusBadge } from "./package-status-badges";

interface ArchivedPackagesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packages: PackageListItem[];
  canRestore: boolean;
}

/**
 * Read view of archived packages with a one-click Restore, mirroring
 * `departure-groups/components/archived-groups-sheet.tsx`.
 */
const ArchivedPackagesSheet = ({
  open,
  onOpenChange,
  packages,
  canRestore,
}: ArchivedPackagesSheetProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const restore = (pkg: PackageListItem) => {
    setRestoringId(pkg.id);
    startTransition(async () => {
      const result = await restorePackageAction(pkg.id);
      setRestoringId(null);

      if (!result.ok) {
        toast.add({
          title: "Could not restore package",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: "Package restored",
        description: `${pkg.title} is back on the active list as a draft.`,
      });
      if (packages.length <= 1) onOpenChange(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-md w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle>Archived Packages</SheetTitle>
          <SheetDescription className="mt-1">
            Retired package templates that have been filed away. They stay
            readable and can be restored to the active catalogue as a draft.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4">
          {packages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <PackageOpen className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No archived packages
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Archiving a package from the list moves it here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="rounded-md border border-border/50 bg-card/50 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {pkg.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <Badge
                        variant="outline"
                        className="text-[10px] tabular-nums text-muted-foreground"
                      >
                        {pkg.code}
                      </Badge>
                      <JourneyTypeBadge value={pkg.journeyType} />
                      <PackageStatusBadge value={pkg.status} />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/packages/${pkg.id}`)}
                    >
                      <Eye /> Open
                    </Button>
                    {canRestore && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isPending && restoringId === pkg.id}
                        onClick={() => restore(pkg)}
                      >
                        {isPending && restoringId === pkg.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <ArchiveRestore />
                        )}
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ArchivedPackagesSheet;
