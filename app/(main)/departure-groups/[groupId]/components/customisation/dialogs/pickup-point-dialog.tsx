"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import React, { useState } from "react";

import type {
  DepartureGroupManifestRow,
  DepartureGroupTransport,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";

interface PickupPointDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  transports: DepartureGroupTransport[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const PickupPointDialog = ({
  row,
  departureGroupId,
  transports,
  open,
  onClose,
  embedded = false,
}: PickupPointDialogProps) => {
  const [transportId, setTransportId] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setTransportId("");
    setPickupLocation("");
    common.reset();
  });

  const detail = pickupLocation.trim()
    ? {
        kind: "PICKUP_POINT" as const,
        transportId: transportId || null,
        pickupLocation: pickupLocation.trim(),
      }
    : null;

  const autoSummary = detail
    ? `Different pickup: ${detail.pickupLocation}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "PICKUP_POINT",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {transports.length > 0 && (
          <Select value={transportId} onValueChange={(value) => setTransportId(value as string)}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Link to group transport (optional)" />
            </SelectTrigger>
            <SelectContent>
              {transports.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.routeLabel}: {t.origin} → {t.destination}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          placeholder="Pickup location"
          value={pickupLocation}
          onChange={(e) => setPickupLocation(e.target.value)}
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
          <DialogTitle>Different Pickup Point</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default PickupPointDialog;
