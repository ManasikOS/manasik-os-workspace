"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { transportSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert, Link2, Link2Off } from "lucide-react";
import React, { useEffect, useState, useTransition } from "react";

import {
  listActiveSuppliersAction,
  upsertGroupTransportAction,
  type ActiveSupplierOption,
} from "../../actions";
import type { DepartureGroupTransport } from "../../types";
import { SUPPLIER_STATUS_LABELS } from "../../utils";
import { SUPPLIER_TYPES_BY_CONTEXT } from "./supplier-picker-types";
import { DateTimePicker } from "@/components/date-time-picker";

type SupplierStatus = keyof typeof SUPPLIER_STATUS_LABELS;

const STATUSES = Object.keys(SUPPLIER_STATUS_LABELS) as SupplierStatus[];

const VEHICLE_LABELS: Record<string, string> = {
  COACH: "Coach",
  VAN: "Van",
  PRIVATE_CAR: "Private car",
  TRAIN: "Train",
  OTHER: "Other",
};

type VehicleTypeOption = keyof typeof VEHICLE_LABELS;

const VEHICLE_TYPES = Object.keys(VEHICLE_LABELS) as VehicleTypeOption[];

interface AddEditTransportSheetProps {
  /** Null to add a new transport route. */
  transport: DepartureGroupTransport | null;
  departureGroupId: string;
  role: StaffRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "2026-09-20T14:30:00.000Z" -> "2026-09-20T14:30" in the browser's local time. */
function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** "2026-09-20T14:30" (local) -> a real ISO string, or null if empty/invalid. */
function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Creates or edits a transport route — supplier, vehicle, driver, coordinator
 * and pickup details all live in one place, since assigning a supplier
 * usually means fixing the vehicle and pickup at the same time.
 */
const AddEditTransportSheet = ({
  transport,
  departureGroupId,
  role,
  open,
  onOpenChange,
}: AddEditTransportSheetProps) => {
  const can = capabilitiesFor(role);
  const [isPending, startTransition] = useTransition();
  const isEdit = transport !== null;

  const [routeLabel, setRouteLabel] = useState(transport?.routeLabel ?? "");
  const [origin, setOrigin] = useState(transport?.origin ?? "");
  const [destination, setDestination] = useState(transport?.destination ?? "");
  const [status, setStatus] = useState<SupplierStatus>(
    (transport?.status as SupplierStatus) ?? "NOT_REQUESTED",
  );
  const [supplierName, setSupplierName] = useState(
    transport?.supplierName ?? "",
  );
  const [supplierId, setSupplierId] = useState<string | null>(
    transport?.supplierId ?? null,
  );
  const [supplierOptions, setSupplierOptions] = useState<
    ActiveSupplierOption[]
  >([]);
  const [bookingReference, setBookingReference] = useState(
    transport?.bookingReference ?? "",
  );
  const [vehicleType, setVehicleType] = useState<VehicleTypeOption>(
    (transport?.vehicleType as VehicleTypeOption) ?? "COACH",
  );
  const [vehicleCapacity, setVehicleCapacity] = useState(
    transport?.vehicleCapacity != null ? String(transport.vehicleCapacity) : "",
  );
  const [passengerCount, setPassengerCount] = useState(
    transport?.passengerCount != null ? String(transport.passengerCount) : "",
  );
  const [pickupAt, setPickupAt] = useState(
    toLocalInputValue(transport?.pickupAt),
  );
  const [pickupLocation, setPickupLocation] = useState(
    transport?.pickupLocation ?? "",
  );
  const [driverName, setDriverName] = useState(transport?.driverName ?? "");
  const [driverPhone, setDriverPhone] = useState(transport?.driverPhone ?? "");
  const [coordinatorName, setCoordinatorName] = useState(
    transport?.coordinatorName ?? "",
  );
  const [coordinatorPhone, setCoordinatorPhone] = useState(
    transport?.coordinatorPhone ?? "",
  );
  const [internalCost, setInternalCost] = useState(
    transport?.internalCost != null ? String(transport.internalCost) : "",
  );
  const [notes, setNotes] = useState(transport?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  // Without this re-sync "Assign Supplier" opened blank on an existing route,
  // and saving it wiped the supplier, vehicle, driver, pickup and cost already
  // on file — the sheet is mounted with `transport === null`, so every field
  // above is seeded from nothing.
  useResetOnOpen(open, transport?.id ?? "", () => {
    setRouteLabel(transport?.routeLabel ?? "");
    setOrigin(transport?.origin ?? "");
    setDestination(transport?.destination ?? "");
    setStatus((transport?.status as SupplierStatus) ?? "NOT_REQUESTED");
    setSupplierName(transport?.supplierName ?? "");
    setSupplierId(transport?.supplierId ?? null);
    setBookingReference(transport?.bookingReference ?? "");
    setVehicleType((transport?.vehicleType as VehicleTypeOption) ?? "COACH");
    setVehicleCapacity(
      transport?.vehicleCapacity != null
        ? String(transport.vehicleCapacity)
        : "",
    );
    setPassengerCount(
      transport?.passengerCount != null ? String(transport.passengerCount) : "",
    );
    setPickupAt(toLocalInputValue(transport?.pickupAt));
    setPickupLocation(transport?.pickupLocation ?? "");
    setDriverName(transport?.driverName ?? "");
    setDriverPhone(transport?.driverPhone ?? "");
    setCoordinatorName(transport?.coordinatorName ?? "");
    setCoordinatorPhone(transport?.coordinatorPhone ?? "");
    setInternalCost(
      transport?.internalCost != null ? String(transport.internalCost) : "",
    );
    setNotes(transport?.notes ?? "");
    setError(null);
  });

  useEffect(() => {
    if (!open) return;
    listActiveSuppliersAction([...SUPPLIER_TYPES_BY_CONTEXT.TRANSPORT]).then((res) => {
      if (res.ok) setSupplierOptions(res.suppliers);
    });
  }, [open]);

  const submit = () => {
    setError(null);

    const payload = {
      id: transport?.id,
      departureGroupId,
      templateTransportRequirementId:
        transport?.templateTransportRequirementId ?? undefined,
      routeLabel: routeLabel.trim(),
      origin: origin.trim(),
      destination: destination.trim(),
      status,
      supplierName: supplierName.trim() || undefined,
      supplierId,
      bookingReference: bookingReference.trim() || undefined,
      vehicleType,
      vehicleCapacity: vehicleCapacity.trim()
        ? Math.max(0, Math.round(Number(vehicleCapacity)))
        : undefined,
      passengerCount: passengerCount.trim()
        ? Math.max(0, Math.round(Number(passengerCount)))
        : undefined,
      pickupAt: fromLocalInputValue(pickupAt),
      pickupLocation: pickupLocation.trim() || undefined,
      driverName: driverName.trim() || undefined,
      driverPhone: driverPhone.trim() || undefined,
      coordinatorName: coordinatorName.trim() || undefined,
      coordinatorPhone: coordinatorPhone.trim() || undefined,
      internalCost: internalCost.trim() ? Number(internalCost) : undefined,
      notes: notes.trim() || undefined,
    };

    const check = transportSchema.safeParse(payload);
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "That transport route is not valid.",
      );
      return;
    }

    startTransition(async () => {
      const result = await upsertGroupTransportAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Transport route saved",
        description: routeLabel,
      });
      onOpenChange(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-2xl! gap-0  overflow-y-hidden custom-scroll">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? "Assign Supplier" : "Add Transport Route"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? `${transport.origin} → ${transport.destination}`
              : "Add a transport route for this group."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto custom-scroll">
          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Route label <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={routeLabel}
                onChange={(e) => setRouteLabel(e.target.value)}
                placeholder="Jeddah Airport → Makkah"
                autoFocus
              />
            </InputGroup>
            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Status</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={SUPPLIER_STATUS_LABELS[status]}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {STATUSES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setStatus(option)}
                    >
                      {SUPPLIER_STATUS_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Origin <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Jeddah Airport"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Destination <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Makkah"
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Supplier</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={supplierName || "No supplier assigned"}
                      className={supplierName ? undefined : "text-muted-foreground"}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56 max-h-64 overflow-y-auto">
                  {supplierId && (
                    <DropdownMenuItem
                      onClick={() => {
                        setSupplierId(null);
                        setSupplierName("");
                      }}
                      className="text-muted-foreground"
                    >
                      <Link2Off className="size-3.5" /> Clear supplier
                    </DropdownMenuItem>
                  )}
                  {supplierOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground max-w-56">
                      No transport companies or brokers in your Supplier Directory yet.
                    </div>
                  ) : (
                    supplierOptions.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => {
                          setSupplierName(s.name);
                          setSupplierId(s.id);
                        }}
                      >
                        {supplierId === s.id && <Link2 className="size-3.5" />}
                        {s.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {supplierOptions.length === 0 && (
                <a
                  href="/suppliers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline"
                >
                  Add a transport company to your Supplier Directory →
                </a>
              )}
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Booking reference</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value)}
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText> Vehicle type</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={VEHICLE_LABELS[vehicleType]}
                      className="cursor-pointer"
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {VEHICLE_TYPES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setVehicleType(option)}
                    >
                      {VEHICLE_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Vehicle capacity</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                value={vehicleCapacity}
                onChange={(e) => setVehicleCapacity(e.target.value)}
                className="font-number"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Passengers assigned</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                value={passengerCount}
                onChange={(e) => setPassengerCount(e.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <DateTimePicker
                value={pickupAt}
                onChange={(e) => setPickupAt(e)}
                required
                label="Pickup Time"
              />
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Pickup location</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                placeholder="Hotel lobby"
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Driver name</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Driver phone</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Coordinator name</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={coordinatorName}
                onChange={(e) => setCoordinatorName(e.target.value)}
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Coordinator phone</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={coordinatorPhone}
                onChange={(e) => setCoordinatorPhone(e.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          {can.viewSupplierCosts && (
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Internal cost (optional)</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                value={internalCost}
                onChange={(e) => setInternalCost(e.target.value)}
                className="font-number"
              />
            </InputGroup>
          )}

          <InputGroup className="overflow-hidden min-h-fit">
            <InputGroupAddon align="block-start">
              <InputGroupText>Notes (optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="max-h-24 overflow-y-auto"
            />
          </InputGroup>

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending && <Loader2 className="animate-spin" />}
            {isEdit ? "Save Changes" : "Add Transport Route"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default AddEditTransportSheet;
