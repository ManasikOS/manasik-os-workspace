"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  FileText,
  Hash,
  Loader2,
  Plus,
  Truck,
  Upload,
  UserCog,
} from "lucide-react";
import React, { useState, useTransition } from "react";

import {
  EmptyState,
  SupplierStatusBadge,
} from "../../../components/status-badges";
import type {
  DepartureGroupManifestRow,
  DepartureGroupTransport,
  PilgrimDeviation,
} from "../../../types";
import { formatDateTime, formatExactCurrency } from "../../../utils";
import { markTransportConfirmedAction } from "../../../actions";
import AddEditTransportDialog from "../add-edit-transport-dialog";
import TransportConfirmationDialog from "../transport-confirmation-dialog";
import TransportReferenceDialog from "../transport-reference-dialog";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface TransportTabProps {
  groupId: string;
  transports: DepartureGroupTransport[];
  manifest: DepartureGroupManifestRow[];
  role: StaffRole;
}

const VEHICLE_LABELS: Record<string, string> = {
  COACH: "Coach",
  VAN: "Van",
  PRIVATE_CAR: "Private car",
  TRAIN: "Train",
  OTHER: "Other",
};

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? "font-number" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Every transport requirement copied from the Package Template appears here as
 * a live execution card — a route with a supplier, a vehicle, a driver and a
 * pickup time, not a policy statement.
 */
const TransportTab = ({
  groupId,
  transports,
  manifest,
  role,
}: TransportTabProps) => {
  const can = useDepartureCapabilities(role);
  const [isConfirming, startConfirming] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [transportDialog, setTransportDialog] = useState<
    | { mode: "add" }
    | { mode: "edit"; transport: DepartureGroupTransport }
    | null
  >(null);
  const [referenceTransport, setReferenceTransport] =
    useState<DepartureGroupTransport | null>(null);
  const [confirmationTransport, setConfirmationTransport] =
    useState<DepartureGroupTransport | null>(null);

  const confirmed = transports.filter(
    (transport) =>
      transport.status === "CONFIRMED" || transport.status === "COMPLETED",
  ).length;

  const markConfirmed = (transport: DepartureGroupTransport) => {
    setConfirmingId(transport.id);
    startConfirming(async () => {
      const result = await markTransportConfirmedAction({
        id: transport.id,
        departureGroupId: groupId,
      });
      setConfirmingId(null);

      if (!result.ok) {
        toast.add({
          title: "Could not confirm route",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: "Transport route confirmed",
        description: result.routeLabel,
      });
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <AddEditTransportDialog
        transport={
          transportDialog?.mode === "edit" ? transportDialog.transport : null
        }
        departureGroupId={groupId}
        role={role}
        open={transportDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTransportDialog(null);
        }}
      />
      <TransportReferenceDialog
        transport={referenceTransport}
        departureGroupId={groupId}
        open={referenceTransport !== null}
        onClose={() => setReferenceTransport(null)}
      />
      <TransportConfirmationDialog
        transport={confirmationTransport}
        departureGroupId={groupId}
        open={confirmationTransport !== null}
        onClose={() => setConfirmationTransport(null)}
      />

      <Card className="gap-3">
        <SectionHeading
          title="Transport"
          act={
            can.manageTransport && (
              <Button
                variant="secondary"
                onClick={() => setTransportDialog({ mode: "add" })}
              >
                <Plus /> Add Transport Route
              </Button>
            )
          }
        />
        <p className="text-xs text-muted-foreground">
          <strong className="font-number text-foreground">{confirmed}</strong>{" "}
          of {transports.length} routes confirmed. Routes are copied from the
          Package Template and belong to this group once created.
        </p>
      </Card>

      {transports.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bus className="size-6" />}
            title="No transport routes copied"
            description="Transport requirements from the Package Template become execution cards here."
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {transports.map((transport) => (
            <Card key={transport.id} className="gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Truck className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {transport.routeLabel}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {transport.origin} → {transport.destination}
                    </p>
                  </div>
                </div>
                <SupplierStatusBadge value={transport.status} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Detail
                  label="Supplier / broker"
                  value={transport.supplierName ?? "Not assigned"}
                />
                <Detail
                  label="Booking reference"
                  value={transport.bookingReference ?? "—"}
                  mono
                />
                <Detail
                  label="Vehicle"
                  value={`${VEHICLE_LABELS[transport.vehicleType]}${
                    transport.vehicleCapacity
                      ? ` · ${transport.vehicleCapacity} seats`
                      : ""
                  }`}
                />
                <Detail
                  label="Passengers assigned"
                  value={transport.passengerCount ?? "—"}
                  mono
                />
                <Detail
                  label="Pickup"
                  value={formatDateTime(transport.pickupAt)}
                />
                <Detail
                  label="Pickup location"
                  value={transport.pickupLocation ?? "—"}
                />
                <Detail
                  label="Driver"
                  value={
                    transport.driverName
                      ? `${transport.driverName} · ${transport.driverPhone ?? ""}`
                      : "Not assigned"
                  }
                />
                <Detail
                  label="Coordinator"
                  value={
                    transport.coordinatorName
                      ? `${transport.coordinatorName} · ${
                          transport.coordinatorPhone ?? ""
                        }`
                      : "Not assigned"
                  }
                />
                {transport.internalCost !== null && (
                  <Detail
                    label="Internal cost"
                    value={formatExactCurrency(transport.internalCost)}
                    mono
                  />
                )}
                <Detail
                  label="Confirmation"
                  value={
                    transport.confirmationUrl ? (
                      <a
                        href={transport.confirmationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <FileText className="size-3.5" /> View confirmation
                      </a>
                    ) : (
                      "Not uploaded"
                    )
                  }
                />
              </div>

              {transport.notes && (
                <p className="text-xs text-muted-foreground rounded-sm bg-muted/40 px-3 py-2">
                  {transport.notes}
                </p>
              )}

              {can.manageTransport && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setTransportDialog({ mode: "edit", transport })
                    }
                  >
                    <UserCog /> Assign Supplier
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReferenceTransport(transport)}
                  >
                    <Hash /> Add Reference
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmationTransport(transport)}
                  >
                    <Upload /> Upload Confirmation
                  </Button>
                  {transport.status !== "CONFIRMED" &&
                    transport.status !== "CANCELLED" &&
                    transport.status !== "COMPLETED" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isConfirming && confirmingId === transport.id}
                        onClick={() => markConfirmed(transport)}
                      >
                        {isConfirming && confirmingId === transport.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckCircle2 />
                        )}
                        Mark Confirmed
                      </Button>
                    )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Transport deviations */}
      {(() => {
        const TRANSPORT_DEV_TYPES = new Set([
          "PRIVATE_TRANSFER",
          "PICKUP_POINT",
        ]);
        const transportDevs: {
          pilgrimName: string;
          deviation: PilgrimDeviation;
        }[] = [];
        for (const row of manifest) {
          for (const d of row.deviations) {
            if (
              TRANSPORT_DEV_TYPES.has(d.deviationType) &&
              d.status !== "DECLINED" &&
              d.status !== "CANCELLED"
            ) {
              transportDevs.push({ pilgrimName: row.fullName, deviation: d });
            }
          }
        }

        if (transportDevs.length === 0) return null;

        return (
          <Card className="gap-4">
            <SectionHeading
              title="Transport deviations"
              act={
                <span className="text-xs text-muted-foreground">
                  {transportDevs.length} deviation
                  {transportDevs.length === 1 ? "" : "s"}
                </span>
              }
            />
            <div className="flex flex-col divide-y divide-border/20">
              {transportDevs.map(({ pilgrimName, deviation }) => (
                <div
                  key={deviation.id}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{pilgrimName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {deviation.deviationType.replace(/_/g, " ")} —{" "}
                      {deviation.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {deviation.blocksDeparture && (
                      <AlertTriangle className={`size-3.5 ${TONE_TEXT.warning}`} />
                    )}
                    <Badge
                      className={`text-[10px] ${
                        deviation.status === "REQUESTED"
                          ? TONE_CLASS.warning
                          : deviation.status === "APPROVED"
                            ? TONE_CLASS.info
                            : TONE_CLASS.success
                      }`}
                    >
                      {deviation.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
};

export default TransportTab;
