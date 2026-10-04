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
  VehicleType,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";

interface PrivateTransferDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  transports: DepartureGroupTransport[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const VEHICLES: VehicleType[] = [
  "PRIVATE_CAR",
  "VAN",
  "COACH",
  "TRAIN",
  "OTHER",
];

const PrivateTransferDialog = ({
  row,
  departureGroupId,
  transports,
  open,
  onClose,
  embedded = false,
}: PrivateTransferDialogProps) => {
  const [transportId, setTransportId] = useState("");
  const [route, setRoute] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("PRIVATE_CAR");

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setTransportId("");
    setRoute("");
    setVehicleType("PRIVATE_CAR");
    common.reset();
  });

  const detail = route.trim()
    ? {
        kind: "PRIVATE_TRANSFER" as const,
        transportId: transportId || null,
        route: route.trim(),
        vehicleType,
      }
    : null;

  const autoSummary = detail
    ? `Private transfer: ${detail.route} (${detail.vehicleType.toLowerCase()})`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "PRIVATE_TRANSFER",
    suggestedChargeType: "TRANSPORT_VARIATION",
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
          placeholder="Route — e.g. Airport to Makkah hotel"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
        />
        <Select
          value={vehicleType}
          onValueChange={(value) => setVehicleType(value as VehicleType)}
        >
          <SelectTrigger className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VEHICLES.map((v) => (
              <SelectItem key={v} value={v} className="text-xs">
                {v.replace(/_/g, " ").toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          <DialogTitle>Private Transfer</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default PrivateTransferDialog;
