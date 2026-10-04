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

import type { DepartureGroupManifestRow } from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";

interface RoommateRequestDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  groupTravellers: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const RoommateRequestDialog = ({
  row,
  departureGroupId,
  groupTravellers,
  open,
  onClose,
  embedded = false,
}: RoommateRequestDialogProps) => {
  const [roommateIds, setRoommateIds] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setRoommateIds([]);
    setNote("");
    common.reset();
  });

  const detail =
    roommateIds.length > 0
      ? {
          kind: "ROOMMATE_REQUEST" as const,
          withPilgrimIds: roommateIds,
          ...(note ? { note } : {}),
        }
      : null;

  const autoSummary = detail
    ? `Roommate request (${detail.withPilgrimIds.length} traveller(s))${
        detail.note ? ` — ${detail.note}` : ""
      }`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "ROOMMATE_REQUEST",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <p className="text-xs text-muted-foreground">
          Select travellers this person wants to room with:
        </p>

        <div className="flex flex-wrap gap-4 max-h-40">
          {groupTravellers
            .filter((t) => t.id !== row.id)
            .map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={roommateIds.includes(t.id)}
                  onCheckedChange={(checked) =>
                    setRoommateIds((prev) =>
                      checked
                        ? [...prev, t.id]
                        : prev.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.name}
              </label>
            ))}
        </div>
        <InputGroup className="">
          <InputGroupInput
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </InputGroup>

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
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Roommate Request</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default RoommateRequestDialog;
