"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import React, { useState } from "react";

import type {
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { InputGroupInput } from "@/components/ui/input-group";

interface ItineraryOptOutDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const ItineraryOptOutDialog = ({
  row,
  departureGroupId,
  itinerary,
  open,
  onClose,
  embedded = false,
}: ItineraryOptOutDialogProps) => {
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setItemIds([]);
    setReason("");
    common.reset();
  });

  const detail =
    itemIds.length > 0
      ? {
          kind: "ITINERARY_OPT_OUT" as const,
          itineraryItemIds: itemIds,
          ...(reason ? { reason } : {}),
        }
      : null;

  const autoSummary = detail
    ? `Opts out of ${detail.itineraryItemIds.length} itinerary day(s)${
        detail.reason ? `: ${detail.reason}` : ""
      }`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "ITINERARY_OPT_OUT",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {itinerary.length > 0 ? (
          <div className="flex flex-col gap-4 ">
            {itinerary.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={itemIds.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setItemIds((prev) =>
                      checked
                        ? [...prev, item.id]
                        : prev.filter((id) => id !== item.id),
                    )
                  }
                />
                Day {item.dayNumber}: {item.title} — {item.location}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No itinerary items in the package snapshot.
          </p>
        )}
        <InputGroupInput
          placeholder="Reason (optional)"
          value={reason}
          className="mt-3"
          onChange={(e) => setReason(e.target.value)}
        />

        <DeviationCommonFields common={common} autoSummary={autoSummary} />
      </div>

      <DeviationFormFooter
        embedded={embedded}
        onClose={onClose}
        onSubmit={() => submit(detail, common, autoSummary)}
        disabled={!detail || isPending}
        isPending={isPending}
      />
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Opt Out of Itinerary Day(s)</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default ItineraryOptOutDialog;
