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
import {
  ArchiveRestore,
  CalendarDays,
  Eye,
  Loader2,
  PackageOpen,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import { restoreDepartureGroupAction } from "../actions";
import type { DepartureGroupListItem } from "../types";
import { GroupStatusBadge, JourneyTypeBadge } from "./status-badges";
import { formatShortDate } from "../utils";

interface ArchivedGroupsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DepartureGroupListItem[];
  /** Restore is an Admin-only write; other roles get a read-only list. */
  canRestore: boolean;
}

/**
 * A read view of filed-away groups with a one-click Restore. Kept in a Sheet
 * rather than a separate route so the archive stays one click from the list and
 * a restore refreshes the list underneath it.
 */
const ArchivedGroupsSheet = ({
  open,
  onOpenChange,
  groups,
  canRestore,
}: ArchivedGroupsSheetProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const restore = (group: DepartureGroupListItem) => {
    setRestoringId(group.id);
    startTransition(async () => {
      const result = await restoreDepartureGroupAction(group.id);
      setRestoringId(null);

      if (!result.ok) {
        toast.add({
          title: "Could not restore group",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: "Group restored",
        description: `${result.groupName} is back on the active list.`,
      });
      // The list underneath re-reads from the store; if that empties the
      // archive, close the sheet.
      if (groups.length <= 1) onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-md w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle>Archived Groups</SheetTitle>
          <SheetDescription className="mt-1">
            Completed or cancelled groups that have been filed away. They stay
            readable and can be restored to the active list.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <PackageOpen className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No archived groups
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Archiving a group from the list or its control center moves it
                here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-md border border-border/50 bg-card/50 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {group.groupName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <Badge
                          variant="outline"
                          className="text-[10px] tabular-nums text-muted-foreground"
                        >
                          {group.groupCode}
                        </Badge>
                        <JourneyTypeBadge value={group.journeyType} />
                        <GroupStatusBadge value={group.groupStatus} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
                        <CalendarDays className="size-3" />
                        {formatShortDate(group.departureDate)} –{" "}
                        {formatShortDate(group.returnDate)} · From{" "}
                        {group.packageTemplateName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        router.push(`/departure-groups/${group.id}`)
                      }
                    >
                      <Eye /> Open
                    </Button>
                    {canRestore && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isPending && restoringId === group.id}
                        onClick={() => restore(group)}
                      >
                        {isPending && restoringId === group.id ? (
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

export default ArchivedGroupsSheet;
