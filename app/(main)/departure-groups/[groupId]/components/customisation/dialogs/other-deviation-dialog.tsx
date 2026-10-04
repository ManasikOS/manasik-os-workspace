"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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

interface OtherDeviationDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const OtherDeviationDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  embedded = false,
}: OtherDeviationDialogProps) => {
  const [note, setNote] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setNote("");
    common.reset();
  });

  const detail = note.trim()
    ? { kind: "OTHER" as const, note: note.trim() }
    : null;
  const autoSummary = detail ? detail.note : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "OTHER",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <Textarea
          rows={3}
          placeholder="Describe the deviation"
          value={note}
          onChange={(e) => setNote(e.target.value)}
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
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Other Customisation</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default OtherDeviationDialog;
