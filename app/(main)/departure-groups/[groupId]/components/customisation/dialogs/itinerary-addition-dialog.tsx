"use client";

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
  deviationGrid2Cls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface ItineraryAdditionDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const ItineraryAdditionDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  embedded = false,
}: ItineraryAdditionDialogProps) => {
  const [title, setTitle] = useState("");
  const [dayNumber, setDayNumber] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setTitle("");
    setDayNumber("");
    setLocation("");
    setDescription("");
    setSupplier("");
    common.reset();
  });

  const detail =
    title.trim() && location.trim()
      ? {
          kind: "ITINERARY_ADDITION" as const,
          title: title.trim(),
          dayNumber: dayNumber ? Number(dayNumber) : null,
          location: location.trim(),
          description,
          ...(supplier ? { supplierName: supplier } : {}),
        }
      : null;

  const autoSummary = detail
    ? `Additional activity: ${detail.title} at ${detail.location}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "ITINERARY_ADDITION",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText> Activity title</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="e.g Visiting Hira cave"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </InputGroup>
        <div className={deviationGrid2Cls}>
          <InputGroupInput
            type="number"
            min={1}
            placeholder="Day number"
            value={dayNumber}
            onChange={(e) => setDayNumber(e.target.value)}
          />
          <InputGroupInput
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Description (optional)</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            rows={2}
            placeholder="Enter your description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Supplier (optional)</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Enter your supplier name"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
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
          <DialogTitle>Add an Activity</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default ItineraryAdditionDialog;
