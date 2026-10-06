"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  groupBookingSchema,
  toDepartureGroupFieldErrors,
  type DepartureGroupFieldErrors,
} from "@/lib/validations/departure-groups";
import { Loader2, TriangleAlert, Users } from "lucide-react";
import React, { useMemo, useState, useTransition } from "react";

import { createGroupBookingAction } from "../actions";
import type {
  BookingStatus,
  DepartureGroupListItem,
  DepartureGroupPricing,
  RoomType,
} from "../types";
import { ROOM_TYPE_LABELS, formatExactCurrency } from "../utils";
import { TONE_CLASS } from "@/lib/ui/tone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ButtonGroup } from "@/components/ui/button-group";
import SectionHeading from "@/components/section-heading";
import { CURRENCY_LABELS, CURRENT_CURRENCY } from "@/lib/data/suppliers-copy";

interface AddBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DepartureGroupListItem;
  pricing: DepartureGroupPricing;
  /** Bookings already on the group — used to prefill the next reference. */
  existingBookingCount: number;
  role: StaffRole;
}

const OCCUPANCIES: RoomType[] = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"];

const BOOKING_STATUS_CHOICES: {
  value: BookingStatus;
  label: string;
  hint: string;
}[] = [
  {
    value: "HELD",
    label: "Held",
    hint: "Reserves seats temporarily until the hold expires.",
  },
  {
    value: "DEPOSIT_PENDING",
    label: "Deposit Pending",
    hint: "Confirms seats while the deposit is collected.",
  },
  {
    value: "CONFIRMED",
    label: "Confirmed",
    hint: "Books the seats outright.",
  },
  {
    value: "WAITLIST",
    label: "Waitlist",
    hint: "Queues the party without taking a seat.",
  },
];

type TravellerType = "ADULT" | "CHILD" | "INFANT";

const TRAVELLER_TYPE_LABELS: Record<TravellerType, string> = {
  ADULT: "Adult",
  CHILD: "Child",
  INFANT: "Infant",
};
const TRAVELLER_TYPE_CHOICES: TravellerType[] = ["ADULT", "CHILD", "INFANT"];

interface FormState {
  primaryContactName: string;
  primaryContactPhoneCode: string;
  primaryContactPhoneNumber: string;

  primaryContactPassportNumber: string;
  primaryContactTravellerType: TravellerType;
  travellerCount: string;
  roomOccupancyPreference: RoomType;
  bookingStatus: BookingStatus;
  packagePricePerPerson: string;
  amountPaid: string;
}

interface AdditionalTraveller {
  fullName: string;
  passportNumber: string;
  phone: string;
  travellerType: TravellerType;
}

/**
 * Creates a booking (and its pilgrim records) against a live group. The seat
 * maths and price default come from the group's own current pricing, so what the
 * operator sees here is what the group will actually record.
 */
const AddBookingSheet = ({
  open,
  onOpenChange,
  group,
  pricing,
  existingBookingCount,
  role,
}: AddBookingSheetProps) => {
  const can = capabilitiesFor(role);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<DepartureGroupFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Details for travellers 2..N. Traveller 1 is the primary contact above.
  const [additional, setAdditional] = useState<AdditionalTraveller[]>([]);
  /** Whether the operator has tried to submit — gates showing per-row errors. */
  const [submitted, setSubmitted] = useState(false);

  const priceByOccupancy = useMemo(
    () =>
      ({
        QUAD: pricing.quadPrice,
        TRIPLE: pricing.triplePrice,
        DOUBLE: pricing.doublePrice,
        SINGLE: pricing.singlePrice,
        OTHER: pricing.quadPrice,
      }) as Record<RoomType, number | null>,
    [pricing],
  );

  const defaultPrice = String(priceByOccupancy.QUAD ?? 0);

  /**
   * The group's child/infant rates from its own pricing sheet — falling back
   * to the booking's own per-person rate when a rate hasn't been set on the
   * group, so choosing "Child" never silently drops a traveller's price to
   * zero.
   */
  const priceByTravellerType = (
    adultPrice: number,
  ): Record<TravellerType, number> => ({
    ADULT: adultPrice,
    CHILD: pricing.childPrice ?? adultPrice,
    INFANT: pricing.infantPrice ?? adultPrice,
  });

  // A role that cannot record payments may not start a booking as confirmed or
  // with money already received — the server refuses both — so it starts as a
  // deposit-pending booking with nothing paid.
  const startingStatus: BookingStatus =
    group.salesStatus === "WAITLIST"
      ? "WAITLIST"
      : can.recordPayments
        ? "CONFIRMED"
        : "DEPOSIT_PENDING";
  const startingAmountPaid =
    can.recordPayments && pricing.advanceDeposit
      ? String(pricing.advanceDeposit)
      : "0";

  const [form, setForm] = useState<FormState>({
    primaryContactName: "",
    primaryContactPhoneCode: "+94",
    primaryContactPhoneNumber: "",
    primaryContactPassportNumber: "",
    primaryContactTravellerType: "ADULT",
    travellerCount: "1",
    roomOccupancyPreference: "QUAD",
    bookingStatus: startingStatus,
    packagePricePerPerson: defaultPrice,
    amountPaid: startingAmountPaid,
  });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  /**
   * Keeps the additional-traveller rows in step with the traveller count. Row
   * count is always `count - 1` (traveller 1 is the primary contact), and
   * existing entries are preserved when the count grows or shrinks.
   */
  const setTravellerCount = (value: string) => {
    setField("travellerCount", value);
    const count = Math.max(0, Math.floor(Number(value) || 0));
    const needed = Math.max(count - 1, 0);
    setAdditional((prev) => {
      if (prev.length === needed) return prev;
      if (prev.length < needed) {
        return [
          ...prev,
          ...Array.from({ length: needed - prev.length }, () => ({
            fullName: "",
            passportNumber: "",
            phone: "",
            travellerType: "ADULT" as TravellerType,
          })),
        ];
      }
      return prev.slice(0, needed);
    });
  };

  const updateTraveller = (
    index: number,
    key: "fullName" | "passportNumber" | "phone",
    value: string,
  ) => {
    setAdditional((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  };

  const setTravellerType = (index: number, type: TravellerType) => {
    setAdditional((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, travellerType: type } : row,
      ),
    );
  };

  const reset = () => {
    setErrors({});
    setFormError(null);
    setSubmitted(false);
    setAdditional([]);
    setForm({
      primaryContactName: "",
      primaryContactPhoneCode: "+94",
      primaryContactPhoneNumber: "",
      primaryContactPassportNumber: "",
      primaryContactTravellerType: "ADULT",
      travellerCount: "1",
      roomOccupancyPreference: "QUAD",
      bookingStatus: startingStatus,
      packagePricePerPerson: defaultPrice,
      amountPaid: startingAmountPaid,
    });
  };

  /** Selecting an occupancy re-prices the booking to that tier's current rate. */
  const chooseOccupancy = (occupancy: RoomType) => {
    const price = priceByOccupancy[occupancy];
    setForm((prev) => ({
      ...prev,
      roomOccupancyPreference: occupancy,
      packagePricePerPerson:
        price !== null && price !== undefined
          ? String(price)
          : prev.packagePricePerPerson,
    }));
  };

  const travellerCount = Math.max(
    0,
    Math.floor(Number(form.travellerCount) || 0),
  );
  const pricePerPerson = Math.max(0, Number(form.packagePricePerPerson) || 0);
  const amountPaid = Math.max(0, Number(form.amountPaid) || 0);
  const ratesByType = priceByTravellerType(pricePerPerson);
  // Summed per-traveller rather than `pricePerPerson × travellerCount` — a
  // child or infant on the booking is charged the group's own child/infant
  // rate, not the adult per-person price.
  const totalValue =
    ratesByType[form.primaryContactTravellerType] +
    additional.reduce((sum, row) => sum + ratesByType[row.travellerType], 0);
  const outstanding = Math.max(totalValue - amountPaid, 0);

  const consumesSeats =
    form.bookingStatus !== "WAITLIST" && form.bookingStatus !== "CANCELLED";
  const exceedsCapacity =
    consumesSeats && travellerCount > group.availableSeats;

  const generatedReference = `${group.groupCode}-BK${String(
    existingBookingCount + 1,
  ).padStart(3, "0")}`;

  const fieldError = (key: string) => errors[key]?.[0];

  // Per-row validity for travellers 2..N — a name is required for each.
  const additionalErrors = additional.map((row) =>
    row.fullName.trim().length >= 2 ? null : "Enter this traveller's name.",
  );
  const hasTravellerErrors = additionalErrors.some(Boolean);

  // Gate the submit button — every required field must be filled.
  const isFormComplete =
    form.primaryContactName.trim().length >= 2 &&
    form.primaryContactPhoneNumber.trim().length >= 1 &&
    travellerCount >= 1 &&
    pricePerPerson > 0 &&
    !hasTravellerErrors;

  /**
   * Full traveller list: primary contact first, then the additional rows.
   * `pricePerPerson` is only sent as a per-traveller override for a
   * Child/Infant — an all-adult booking keeps relying on the booking's own
   * uniform rate exactly as before.
   */
  const buildTravellers = () => [
    {
      fullName: form.primaryContactName.trim(),
      phone:
        form.primaryContactPhoneCode + form.primaryContactPhoneNumber ||
        undefined,
      passportNumber: form.primaryContactPassportNumber.trim() || undefined,
      pricePerPerson:
        form.primaryContactTravellerType === "ADULT"
          ? undefined
          : ratesByType[form.primaryContactTravellerType],
    },
    ...additional.map((row) => ({
      fullName: row.fullName.trim(),
      phone: row.phone.trim() || undefined,
      passportNumber: row.passportNumber.trim() || undefined,
      pricePerPerson:
        row.travellerType === "ADULT"
          ? undefined
          : ratesByType[row.travellerType],
    })),
  ];

  const submit = () => {
    setSubmitted(true);
    setFormError(null);

    if (hasTravellerErrors) {
      setFormError("Enter a name for every traveller.");

      return;
    }

    const payload = {
      departureGroupId: group.id,
      bookingReference: generatedReference,
      bookingStatus: form.bookingStatus,
      primaryContactName: form.primaryContactName,
      primaryContactPhone:
        form.primaryContactPhoneCode + form.primaryContactPhoneNumber,
      travellerCount,
      roomOccupancyPreference: form.roomOccupancyPreference,
      packagePricePerPerson: pricePerPerson,
      amountPaid,
      travellers: buildTravellers(),
    };

    const parsed = groupBookingSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(toDepartureGroupFieldErrors(parsed.error));
      setFormError("Check the highlighted fields and try again.");

      return;
    }

    if (exceedsCapacity) {
      setFormError(
        group.waitlistEnabled
          ? `Only ${group.availableSeats} seat${
              group.availableSeats === 1 ? "" : "s"
            } left — reduce the party size or set the status to Waitlist.`
          : `Only ${group.availableSeats} seat${
              group.availableSeats === 1 ? "" : "s"
            } left and the waitlist is disabled.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await createGroupBookingAction(payload);
      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) setErrors(result.fieldErrors);
        return;
      }

      toast.add({
        title: "Booking added",
        description: `${result.bookingReference} · ${result.travellerCount} traveller${
          result.travellerCount === 1 ? "" : "s"
        } added to ${group.groupName}.`,
      });
      onOpenChange(false);
      reset();
    });
  };

  const seatsAfter = consumesSeats
    ? Math.max(group.availableSeats - travellerCount, 0)
    : group.availableSeats;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-lg w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle>Add Booking</SheetTitle>
          <SheetDescription className="mt-1">
            Create a booking on {group.groupName}. Pilgrim records, the document
            checklist and payment state are generated automatically.
          </SheetDescription>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            <span className="font-number text-foreground">
              {group.availableSeats}
            </span>{" "}
            of {group.capacity} seats available
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4 flex flex-col gap-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SectionHeading
                title="Lead traveller"
                description="The booking's primary contact, counted as traveller 1."
              />
            </div>

            <div className="col-span-2">
              <Field
                label="Full Name"
                required
                error={fieldError("primaryContactName")}
              >
                <InputGroupInput
                  value={form.primaryContactName}
                  onChange={(e) =>
                    setField("primaryContactName", e.target.value)
                  }
                  placeholder="Eg. Mohamed Afras"
                />
              </Field>
            </div>
            <Field
              label="Phone"
              required
              error={fieldError("primaryContactPhone")}
            >
              <ButtonGroup orientation={"horizontal"} className="w-full">
                <InputGroupInput
                  value={form.primaryContactPhoneCode}
                  onChange={(e) =>
                    setField("primaryContactPhoneCode", e.target.value)
                  }
                  placeholder="+94"
                  className="flex-1"
                />
                <InputGroupInput
                  value={form.primaryContactPhoneNumber}
                  onChange={(e) =>
                    setField("primaryContactPhoneNumber", e.target.value)
                  }
                  placeholder="77 123 4567"
                  className="flex-4"
                />
              </ButtonGroup>
            </Field>

            <Field label="Passport Number">
              <InputGroupInput
                value={form.primaryContactPassportNumber}
                onChange={(e) =>
                  setField("primaryContactPassportNumber", e.target.value)
                }
                placeholder="N1234567"
                className="font-number"
              />
            </Field>

            <SelectMenu
              label="Traveller Type"
              value={form.primaryContactTravellerType}
              options={TRAVELLER_TYPE_CHOICES.map((type) => ({
                value: type,
                label: `${TRAVELLER_TYPE_LABELS[type]}${
                  type !== "ADULT"
                    ? ` — ${formatExactCurrency(ratesByType[type], pricing.currency)}`
                    : ""
                }`,
              }))}
              onChange={(value) =>
                setField("primaryContactTravellerType", value as TravellerType)
              }
            />

            <Field
              label="Travellers"
              required
              error={fieldError("travellerCount")}
            >
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={1}
                value={form.travellerCount}
                onChange={(e) => setTravellerCount(e.target.value)}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                className="font-number"
              />
            </Field>

            <SelectMenu
              label="Room Occupancy"
              value={form.roomOccupancyPreference}
              options={OCCUPANCIES.map((occupancy) => ({
                value: occupancy,
                label: ROOM_TYPE_LABELS[occupancy],
              }))}
              onChange={(value) => chooseOccupancy(value as RoomType)}
            />

            <SelectMenu
              label="Booking Status"
              value={form.bookingStatus}
              options={BOOKING_STATUS_CHOICES.filter(
                (choice) =>
                  can.recordPayments ||
                  choice.value === "HELD" ||
                  choice.value === "DEPOSIT_PENDING" ||
                  choice.value === "WAITLIST",
              ).map((choice) => ({
                value: choice.value,
                label: choice.label,
              }))}
              onChange={(value) =>
                setField("bookingStatus", value as BookingStatus)
              }
            />

            <Field
              label="Package Price / Person"
              error={fieldError("packagePricePerPerson")}
              hint={
                can.overrideCapacityAndPrice
                  ? "From the group's current price — editable."
                  : "From the group's current price."
              }
            >
              <ButtonGroup className="w-full items-center">
                <InputGroupInput
                  value={CURRENT_CURRENCY}
                  readOnly
                  className="flex-1"
                />
                <CurrencyInput
                  inputMode="numeric"
                  min={0}
                  value={parseInt(form.packagePricePerPerson)}
                  onValueChange={(val) =>
                    setField("packagePricePerPerson", String(val))
                  }
                  disabled={!can.overrideCapacityAndPrice}
                  className="font-number flex-6"
                />
              </ButtonGroup>
            </Field>

            <Field
              label="Amount Paid (deposit)"
              className="col-span-2"
              error={fieldError("amountPaid")}
              hint={
                !can.recordPayments
                  ? "Finance records payments. Create the booking without one."
                  : pricing.advanceDeposit
                  ? `Advance deposit: ${formatExactCurrency(
                      pricing.advanceDeposit,
                      pricing.currency,
                    )}`
                  : undefined
              }
            >
              <ButtonGroup className="w-full items-center">
                <InputGroupInput
                  value={CURRENT_CURRENCY}
                  readOnly
                  className="flex-1"
                />
                <CurrencyInput
                  inputMode="numeric"
                  min={0}
                  value={parseInt(form.amountPaid)}
                  onValueChange={(val) => setField("amountPaid", String(val))}
                  disabled={!can.recordPayments}
                  className="font-number flex-6"
                />
              </ButtonGroup>
            </Field>
          </div>

          {/* Per-traveller details for travellers 2..N */}
          {additional.length > 0 && (
            <>
              {/* <Separator /> */}
              <div className="flex flex-col gap-7 mt-5">
                <div>
                  <p className="text-lg font-medium text-foreground">
                    Additional travellers
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Enter each traveller&apos;s details. Passport can be added
                    now or later.
                  </p>
                </div>

                {additional.map((row, index) => (
                  <Card
                    key={index}
                    className="rounded-sm bg-card/40 px-5 py-5 flex flex-col gap-3"
                  >
                    <p className="text-sm  text-muted-foreground">
                      Traveller {index + 2}
                    </p>
                    <Field
                      label="Full Name"
                      required
                      error={
                        submitted
                          ? (additionalErrors[index] ?? undefined)
                          : undefined
                      }
                    >
                      <InputGroupInput
                        value={row.fullName}
                        onChange={(e) =>
                          updateTraveller(index, "fullName", e.target.value)
                        }
                        placeholder="Traveller full name"
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Passport Number">
                        <InputGroupInput
                          value={row.passportNumber}
                          onChange={(e) =>
                            updateTraveller(
                              index,
                              "passportNumber",
                              e.target.value,
                            )
                          }
                          placeholder="N1234567"
                          className="font-number"
                        />
                      </Field>
                      <Field label="Phone">
                        <InputGroupInput
                          value={row.phone}
                          onChange={(e) =>
                            updateTraveller(index, "phone", e.target.value)
                          }
                          placeholder="+94 77 000 0000"
                        />
                      </Field>
                      <SelectMenu
                        label="Traveller Type"
                        value={row.travellerType}
                        options={TRAVELLER_TYPE_CHOICES.map((type) => ({
                          value: type,
                          label: `${TRAVELLER_TYPE_LABELS[type]}${
                            type !== "ADULT"
                              ? ` — ${formatExactCurrency(ratesByType[type], pricing.currency)}`
                              : ""
                          }`,
                        }))}
                        onChange={(value) =>
                          setTravellerType(index, value as TravellerType)
                        }
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* <Separator /> */}

          {/* Live summary */}
          <Card className="min-h-fit gap-5 bg-transparent mt-4 flex flex-col">
            <SummaryRow
              label="Booking reference"
              value={generatedReference}
              mono
            />
            <SummaryRow
              label="Total booking value"
              value={formatExactCurrency(totalValue, pricing.currency)}
              mono
            />
            <SummaryRow
              label="Amount paid"
              value={formatExactCurrency(amountPaid, pricing.currency)}
              mono
            />
            <SummaryRow
              label="Outstanding balance"
              value={formatExactCurrency(outstanding, pricing.currency)}
              mono
              tone={outstanding > 0 ? "text-destructive" : undefined}
            />
            <SummaryRow
              label={consumesSeats ? "Seats left after booking" : "Seats left"}
              value={
                consumesSeats
                  ? `${seatsAfter} of ${group.capacity}`
                  : `${group.availableSeats} (waitlisted — no seat taken)`
              }
              mono
            />
          </Card>

          {exceedsCapacity && (
            <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", TONE_CLASS.warning)}>
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>
                This party is larger than the {group.availableSeats} seat
                {group.availableSeats === 1 ? "" : "s"} left.{" "}
                {group.waitlistEnabled
                  ? "Set the status to Waitlist, or reduce the party size."
                  : "Reduce the party size — the waitlist is disabled."}
              </span>
            </div>
          )}

          {formError && !exceedsCapacity && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border/40 flex-row justify-end items-center">
          <Button
            variant="outline_without_border"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || !isFormComplete || exceedsCapacity}
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Add Booking
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

function Field({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup className={cn("text-start items-start", className)}>
        <InputGroupAddon align={"block-start"}>
          <InputGroupText>
            {" "}
            {label}
            {required && <span className="text-destructive"> *</span>}
          </InputGroupText>
        </InputGroupAddon>
        {children}
      </InputGroup>
      {error ? (
        <span className="text-[11px]  text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[11px]  text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function SelectMenu({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
      // render={
      //   <Button
      //     variant="outline_without_border"
      //     className="justify-between w-full font-normal"
      //   >
      //     {selected?.label ?? "Select..."}
      //     <ChevronDown />
      //   </Button>
      // }
      >
        <InputGroup className="cursor-pointer">
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>{label}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={selected?.label ?? "Select..."}
            className="cursor-pointer"
            readOnly
          />
        </InputGroup>{" "}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span
        className={cn(
          "text-foreground text-[15px]",
          mono && "font-number",
          tone,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default AddBookingSheet;
