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
import {
  createAccommodationSchema,
  updateAccommodationSchema,
} from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import {
  ChevronDownIcon,
  Loader2,
  TriangleAlert,
  Link2,
  Link2Off,
} from "lucide-react";

import {
  createAccommodationAction,
  listActiveSuppliersAction,
  updateAccommodationAction,
  type ActiveSupplierOption,
} from "../../actions";
import type {
  AccommodationCity,
  DepartureGroupAccommodation,
} from "../../types";
import { SUPPLIER_STATUS_LABELS } from "../../utils";
import { SUPPLIER_TYPES_BY_CONTEXT } from "./supplier-picker-types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ButtonGroup } from "@/components/ui/button-group";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { DatePicker, toLocalInputValue } from "@/components/date-time-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useEffect, useState, useTransition } from "react";

type SupplierStatus = keyof typeof SUPPLIER_STATUS_LABELS;

const STATUSES = Object.keys(SUPPLIER_STATUS_LABELS) as SupplierStatus[];

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

interface EditAccommodationSheetProps {
  /** Null to add a new accommodation block. */
  accommodation: DepartureGroupAccommodation | null;
  departureGroupId: string;
  role: StaffRole;
  open: boolean;
  setOpen: (value: boolean) => void;
}

const CITY_OPTIONS = Object.keys(CITY_LABELS) as AccommodationCity[];

/**
 * Adds or edits an accommodation block (not rooms — those are assigned
 * separately). `accommodation === null` means "add a new block" — the copy
 * checklist at group creation only decides what gets copied in up front, so
 * this is the only way to add a hotel to a group that skipped (or has run
 * out of) copied blocks.
 */
const EditAccommodationSheet = ({
  accommodation,
  departureGroupId,
  role,
  open,
  setOpen,
}: EditAccommodationSheetProps) => {
  const can = capabilitiesFor(role);
  const [isPending, startTransition] = useTransition();
  const isEdit = accommodation !== null;

  const [city, setCity] = useState<AccommodationCity>(
    accommodation?.city ?? "MAKKAH",
  );
  const [hotelName, setHotelName] = useState(accommodation?.hotelName ?? "");
  const [supplierName, setSupplierName] = useState(
    accommodation?.supplierName ?? "",
  );
  const [supplierId, setSupplierId] = useState<string | null>(
    accommodation?.supplierId ?? null,
  );
  const [supplierOptions, setSupplierOptions] = useState<
    ActiveSupplierOption[]
  >([]);
  const [bookingReference, setBookingReference] = useState(
    accommodation?.bookingReference ??
      `REF-HOTEL-${departureGroupId.slice(0, 4)}`,
  );
  const [status, setStatus] = useState<SupplierStatus>(
    (accommodation?.status as SupplierStatus) ?? "NOT_REQUESTED",
  );
  const [checkInDate, setCheckInDate] = useState(
    accommodation?.checkInDate ?? "",
  );
  const [checkOutDate, setCheckOutDate] = useState(
    accommodation?.checkOutDate ?? "",
  );
  const [roomCapacity, setRoomCapacity] = useState(
    String(accommodation?.roomCapacity ?? 0),
  );
  const [roomsReserved, setRoomsReserved] = useState(
    String(accommodation?.roomsReserved ?? 0),
  );
  const [mealPlan, setMealPlan] = useState(accommodation?.mealPlan ?? "");
  const [distanceDescription, setDistanceDescription] = useState(
    accommodation?.distanceDescription ?? "",
  );
  const [internalCost, setInternalCost] = useState(
    accommodation?.internalCost != null
      ? String(accommodation.internalCost)
      : "",
  );
  const [notes, setNotes] = useState(accommodation?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  // The sheet stays mounted between opens (so it can animate), so the form
  // has to re-sync from `accommodation` each time it opens rather than only
  // on first mount.
  useResetOnOpen(open, accommodation?.id ?? "", () => {
    setCity(accommodation?.city ?? "MAKKAH");
    setHotelName(accommodation?.hotelName ?? "");
    setSupplierName(accommodation?.supplierName ?? "");
    setSupplierId(accommodation?.supplierId ?? null);
    setBookingReference(
      accommodation?.bookingReference ??
        `REF-HOTEL-${departureGroupId.slice(0, 4)}`,
    );
    setStatus((accommodation?.status as SupplierStatus) ?? "NOT_REQUESTED");
    setCheckInDate(accommodation?.checkInDate ?? "");
    setCheckOutDate(accommodation?.checkOutDate ?? "");
    setRoomCapacity(String(accommodation?.roomCapacity ?? 0));
    setRoomsReserved(String(accommodation?.roomsReserved ?? 0));
    setMealPlan(accommodation?.mealPlan ?? "");
    setDistanceDescription(accommodation?.distanceDescription ?? "");
    setInternalCost(
      accommodation?.internalCost != null
        ? String(accommodation.internalCost)
        : "",
    );
    setNotes(accommodation?.notes ?? "");
    setError(null);
  });

  useEffect(() => {
    if (!open) return;
    listActiveSuppliersAction([...SUPPLIER_TYPES_BY_CONTEXT.ACCOMMODATION]).then((res) => {
      if (res.ok) setSupplierOptions(res.suppliers);
    });
  }, [open]);

  const submit = () => {
    setError(null);

    const basePayload = {
      departureGroupId,
      hotelName: hotelName.trim(),
      supplierName: supplierName.trim() || undefined,
      supplierId,
      bookingReference: bookingReference.trim() || undefined,
      status,
      checkInDate: checkInDate.trim(),
      checkOutDate: checkOutDate.trim(),
      roomCapacity: Math.max(0, Math.round(Number(roomCapacity) || 0)),
      roomsReserved: Math.max(0, Math.round(Number(roomsReserved) || 0)),
      mealPlan: mealPlan.trim() || undefined,
      distanceDescription: distanceDescription.trim() || undefined,
      internalCost: internalCost.trim() ? Number(internalCost) : undefined,
      notes: notes.trim() || undefined,
    };

    if (isEdit) {
      const check = updateAccommodationSchema.safeParse({
        ...basePayload,
        id: accommodation.id,
      });
      if (!check.success) {
        setError(
          check.error.issues[0]?.message ?? "That accommodation is not valid.",
        );
        return;
      }

      startTransition(async () => {
        const result = await updateAccommodationAction(check.data);
        if (!result.ok) {
          setError(result.error);
          return;
        }

        toast.add({
          title: "Accommodation updated",
          description: result.hotelName,
        });
        setOpen(false);
      });
      return;
    }

    const check = createAccommodationSchema.safeParse({ ...basePayload, city });
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "That accommodation is not valid.",
      );
      return;
    }

    startTransition(async () => {
      const result = await createAccommodationAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Accommodation added",
        description: result.hotelName,
      });
      setOpen(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="max-w-xl! overflow-y-hidden custom-scroll gap-0">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Accommodation" : "Add Hotel"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? CITY_LABELS[accommodation.city] ?? accommodation.city
              : "Add an accommodation block for this group."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto custom-scroll ">
          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Hotel name <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="Pullman Zamzam Makkah"
                autoFocus
              />
            </InputGroup>
            {isEdit ? (
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
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>
                        City <span className="text-destructive">*</span>
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={CITY_LABELS[city]}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {CITY_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option} onClick={() => setCity(option)}>
                      {CITY_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
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
          )}

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
                      No hotels or brokers in your Supplier Directory yet.
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
                  Add a hotel to your Supplier Directory →
                </a>
              )}
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Booking reference</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={bookingReference}
                readOnly
                disabled
                title="Use the Reference button to change this."
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label={"Check-in"}
              required
              value={checkInDate}
              onChange={(date) => {
                setCheckInDate(date);
              }}
            />
            <DatePicker
              label={"Check-out"}
              required
              value={checkOutDate}
              onChange={(date) => {
                setCheckOutDate(date);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Room capacity</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                value={roomCapacity}
                onChange={(e) => setRoomCapacity(e.target.value)}
                className="font-number"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Rooms reserved</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                value={roomsReserved}
                onChange={(e) => setRoomsReserved(e.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Meal plan</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={mealPlan}
                onChange={(e) => setMealPlan(e.target.value)}
                placeholder="Half board"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Distance</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={distanceDescription}
                onChange={(e) => setDistanceDescription(e.target.value)}
                placeholder="100m from Masjid al-Haram"
              />
            </InputGroup>
          </div>

          {can.viewSupplierCosts && (
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Internal cost (optional)</InputGroupText>
              </InputGroupAddon>
              <ButtonGroup className="w-full items-center">
                <InputGroupAddon>
                  <InputGroupText className="font-number pl-1">
                    LKR
                  </InputGroupText>
                </InputGroupAddon>
                <CurrencyInput
                  inputMode="numeric"
                  min={0}
                  value={parseInt(internalCost)}
                  onValueChange={(e) => setInternalCost(String(e))}
                  className="font-number"
                />
              </ButtonGroup>
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
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending && <Loader2 className="animate-spin" />}
            {isEdit ? "Save Changes" : "Add Hotel"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default EditAccommodationSheet;
