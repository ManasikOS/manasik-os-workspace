"use client";

import { Button } from "@/components/ui/button";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
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
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Info, Loader2, TriangleAlert } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import { updateGroupDetailsAction } from "../../actions";
import type {
  DepartureGroupListItem,
  DepartureGroupPricing,
  DepartureGroupCosting,
  GroupSalesStatus,
  NusukStatus,
} from "../../types";
import { SALES_STATUS_LABELS, formatExactCurrency } from "../../utils";
import { DatePicker } from "@/components/date-time-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ButtonGroup } from "@/components/ui/button-group";
import SectionHeading from "@/components/section-heading";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface EditGroupDetailsSheetProps {
  group: DepartureGroupListItem;
  pricing: DepartureGroupPricing;
  costing: DepartureGroupCosting | null;
  branches: string[];
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

const SALES_STATUSES = Object.keys(SALES_STATUS_LABELS) as GroupSalesStatus[];

const NUSUK_STATUS_LABELS: Record<NusukStatus, string> = {
  NOT_LINKED: "Not linked",
  PROGRAM_LINKED: "Program linked",
  GROUP_SUBMITTED: "Group submitted",
  INVOICE_PENDING: "Invoice pending",
  INVOICE_PAID: "Invoice paid",
  VISAS_ISSUED: "Visas issued",
  REJECTED: "Rejected",
};
const NUSUK_STATUSES = Object.keys(NUSUK_STATUS_LABELS) as NusukStatus[];

/**
 * Edits the group's own details.
 *
 * Duration, seat availability and readiness due dates are all consequences of
 * these fields, so none of them are editable here — the server recomputes them.
 * Capacity is the one control gated beyond `editGroupDetails`, since changing
 * how much the agency can sell is a commercial decision, not an admin tidy-up.
 */
const EditGroupDetailsSheet = ({
  group,
  pricing,
  costing,
  branches,
  role,
  open,
  onClose,
}: EditGroupDetailsSheetProps) => {
  const can = useDepartureCapabilities(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [groupName, setGroupName] = useState(group.groupName);
  const [groupCode, setGroupCode] = useState(group.groupCode);
  const [branch, setBranch] = useState(group.branch);
  const [departureDate, setDepartureDate] = useState(group.departureDate);
  const [returnDate, setReturnDate] = useState(group.returnDate);
  const [capacity, setCapacity] = useState(String(group.capacity));
  const [minimumGroupSize, setMinimumGroupSize] = useState(
    String(group.minimumGroupSize),
  );
  const [salesStatus, setSalesStatus] = useState<GroupSalesStatus>(
    group.salesStatus,
  );
  const [operationsOwnerName, setOperationsOwnerName] = useState(
    group.operationsOwnerName ?? "",
  );
  const [primaryGuideName, setPrimaryGuideName] = useState(
    group.primaryGuideName ?? "",
  );
  const [visaOwnerName, setVisaOwnerName] = useState(group.visaOwnerName ?? "");
  const [financeOwnerName, setFinanceOwnerName] = useState(
    group.financeOwnerName ?? "",
  );
  const [localCoordinatorName, setLocalCoordinatorName] = useState(
    group.localCoordinatorName ?? "",
  );
  const [localCoordinatorPhone, setLocalCoordinatorPhone] = useState(
    group.localCoordinatorPhone ?? "",
  );
  const [waitlistEnabled, setWaitlistEnabled] = useState(group.waitlistEnabled);
  const [seatHoldExpiryHours, setSeatHoldExpiryHours] = useState(
    String(group.seatHoldExpiryHours),
  );
  const [quadPrice, setQuadPrice] = useState(String(pricing.quadPrice ?? ""));
  const [triplePrice, setTriplePrice] = useState(
    String(pricing.triplePrice ?? ""),
  );
  const [doublePrice, setDoublePrice] = useState(
    String(pricing.doublePrice ?? ""),
  );
  const [singlePrice, setSinglePrice] = useState(
    String(pricing.singlePrice ?? ""),
  );
  const [advanceDeposit, setAdvanceDeposit] = useState(
    String(pricing.advanceDeposit ?? ""),
  );
  const [fixedCostPerDeparture, setFixedCostPerDeparture] = useState(
    String(costing?.fixedCostPerDeparture ?? 0),
  );
  const [umrahCompanyName, setUmrahCompanyName] = useState(
    group.umrahCompanyName ?? "",
  );
  const [nusukProgramRef, setNusukProgramRef] = useState(
    group.nusukProgramRef ?? "",
  );
  const [nusukGroupRef, setNusukGroupRef] = useState(
    group.nusukGroupRef ?? "",
  );
  const [visaBatchRef, setVisaBatchRef] = useState(group.visaBatchRef ?? "");
  const [visaInvoiceRef, setVisaInvoiceRef] = useState(
    group.visaInvoiceRef ?? "",
  );
  const [nusukStatus, setNusukStatus] = useState<NusukStatus>(
    group.nusukStatus,
  );
  const [error, setError] = useState<string | null>(null);

  // The sheet stays mounted between opens, so it has to re-read the group each
  // time it opens. Seeding once at mount meant a second edit re-submitted the
  // values from the first page load — silently reverting the save that had just
  // been made, or anything a colleague had changed since.
  useResetOnOpen(open, group.id, () => {
    setGroupName(group.groupName);
    setGroupCode(group.groupCode);
    setBranch(group.branch);
    setDepartureDate(group.departureDate);
    setReturnDate(group.returnDate);
    setCapacity(String(group.capacity));
    setMinimumGroupSize(String(group.minimumGroupSize));
    setSalesStatus(group.salesStatus);
    setOperationsOwnerName(group.operationsOwnerName ?? "");
    setPrimaryGuideName(group.primaryGuideName ?? "");
    setVisaOwnerName(group.visaOwnerName ?? "");
    setFinanceOwnerName(group.financeOwnerName ?? "");
    setLocalCoordinatorName(group.localCoordinatorName ?? "");
    setLocalCoordinatorPhone(group.localCoordinatorPhone ?? "");
    setWaitlistEnabled(group.waitlistEnabled);
    setSeatHoldExpiryHours(String(group.seatHoldExpiryHours));
    setQuadPrice(String(pricing.quadPrice ?? ""));
    setTriplePrice(String(pricing.triplePrice ?? ""));
    setDoublePrice(String(pricing.doublePrice ?? ""));
    setSinglePrice(String(pricing.singlePrice ?? ""));
    setAdvanceDeposit(String(pricing.advanceDeposit ?? ""));
    setFixedCostPerDeparture(String(costing?.fixedCostPerDeparture ?? 0));
    setUmrahCompanyName(group.umrahCompanyName ?? "");
    setNusukProgramRef(group.nusukProgramRef ?? "");
    setNusukGroupRef(group.nusukGroupRef ?? "");
    setVisaBatchRef(group.visaBatchRef ?? "");
    setVisaInvoiceRef(group.visaInvoiceRef ?? "");
    setNusukStatus(group.nusukStatus);
    setError(null);
  });

  const branchChoices = branches.length > 0 ? branches : [group.branch];
  const committedSeats = group.bookedSeats + group.heldSeats;
  const dateMoved = departureDate !== group.departureDate;

  const submit = () => {
    setError(null);

    const parsedCapacity = Math.round(Number(capacity));
    const parsedMinimum = Math.round(Number(minimumGroupSize));
    const parsedHold = Math.round(Number(seatHoldExpiryHours));

    if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) {
      setError("Capacity must be a whole number greater than zero.");
      return;
    }
    if (!Number.isFinite(parsedMinimum) || parsedMinimum < 0) {
      setError("Minimum group size cannot be negative.");
      return;
    }
    if (!Number.isFinite(parsedHold) || parsedHold <= 0) {
      setError("Seat hold expiry must be greater than zero.");
      return;
    }
    if (returnDate < departureDate) {
      setError("Return date cannot be before the departure date.");
      return;
    }

    const parsedQuad = quadPrice.trim() === "" ? null : Number(quadPrice);
    const parsedTriple = triplePrice.trim() === "" ? null : Number(triplePrice);
    const parsedDouble = doublePrice.trim() === "" ? null : Number(doublePrice);
    const parsedSingle = singlePrice.trim() === "" ? null : Number(singlePrice);
    const parsedDeposit =
      advanceDeposit.trim() === "" ? null : Number(advanceDeposit);
    for (const [label, value] of [
      ["Quad price", parsedQuad],
      ["Triple price", parsedTriple],
      ["Double price", parsedDouble],
      ["Single price", parsedSingle],
      ["Advance deposit", parsedDeposit],
    ] as const) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        setError(`${label} must be zero or a positive number.`);
        return;
      }
    }
    // Same rule the create-group sheet enforces up front — checked again
    // here because pricing is just as editable after a group goes live, and
    // this was previously the one place nothing stopped a deposit from being
    // raised above the room price it's meant to be a deposit on.
    if (
      parsedDeposit !== null &&
      parsedQuad !== null &&
      parsedDeposit > parsedQuad
    ) {
      setError("Advance deposit cannot exceed the Quad price.");
      return;
    }

    const parsedFixedCost = Number(fixedCostPerDeparture);
    if (!Number.isFinite(parsedFixedCost) || parsedFixedCost < 0) {
      setError("Fixed cost per departure must be zero or a positive number.");
      return;
    }

    startTransition(async () => {
      const result = await updateGroupDetailsAction({
        groupId: group.id,
        groupName: groupName.trim(),
        groupCode: groupCode.trim().toUpperCase(),
        branch,
        departureDate,
        returnDate,
        // Omitted entirely for roles that cannot reprice capacity, so the
        // action never has to reject an edit the operator could not make.
        ...(can.overrideCapacityAndPrice ? { capacity: parsedCapacity } : {}),
        minimumGroupSize: parsedMinimum,
        salesStatus,
        operationsOwnerName: operationsOwnerName.trim() || null,
        primaryGuideName: primaryGuideName.trim() || null,
        visaOwnerName: visaOwnerName.trim() || null,
        financeOwnerName: financeOwnerName.trim() || null,
        localCoordinatorName: localCoordinatorName.trim() || null,
        localCoordinatorPhone: localCoordinatorPhone.trim() || null,
        waitlistEnabled,
        seatHoldExpiryHours: parsedHold,
        // Omitted entirely for roles that cannot reprice — same convention
        // as `capacity` above.
        ...(can.overrideCapacityAndPrice
          ? {
              pricing: {
                quadPrice: parsedQuad,
                triplePrice: parsedTriple,
                doublePrice: parsedDouble,
                singlePrice: parsedSingle,
                advanceDeposit: parsedDeposit,
              },
              costEstimate: { fixedCostPerDeparture: parsedFixedCost },
            }
          : {}),
        ...(can.manageDocumentsAndVisa
          ? {
              umrahCompanyName: umrahCompanyName.trim() || null,
              nusukProgramRef: nusukProgramRef.trim() || null,
              nusukGroupRef: nusukGroupRef.trim() || null,
              visaBatchRef: visaBatchRef.trim() || null,
              visaInvoiceRef: visaInvoiceRef.trim() || null,
              nusukStatus,
            }
          : {}),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title:
          result.changedFields.length === 0
            ? "Nothing to save"
            : "Group details updated",
        description:
          result.changedFields.length === 0
            ? "No fields were changed."
            : `Updated ${result.changedFields.join(", ")}.${
                result.rescheduledReadinessItems > 0
                  ? ` ${result.rescheduledReadinessItems} readiness item${
                      result.rescheduledReadinessItems === 1 ? "" : "s"
                    } rescheduled.`
                  : ""
              }`,
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-lg w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle className="text-xl pr-8">Edit Group Details</SheetTitle>
          <SheetDescription className="mt-1">
            {group.groupName} · {group.groupCode}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4 flex flex-col gap-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Group name <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </InputGroup>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Group code <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={groupCode}
                onChange={(event) =>
                  setGroupCode(event.target.value.toUpperCase())
                }
                className="font-number"
              />
            </InputGroup>

            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Branch</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput readOnly value={branch} />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  {branchChoices.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setBranch(option)}
                    >
                      {option}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Departure date"
              onChange={(e) => setDepartureDate(e)}
              value={departureDate}
            />
            <DatePicker
              label="Return date"
              onChange={(e) => setReturnDate(e)}
              value={returnDate}
            />
          </div>

          {dateMoved && (
            <div className={`flex items-start gap-2 rounded-sm px-3 py-2 text-[11px] ${TONE_CLASS.warning}`}>
              <Info className="size-3.5 mt-0.5 shrink-0" />
              <span>
                Moving the departure date also moves every readiness item that
                is due a set number of days before departure. Flights, hotels
                and transport keep their own dates — check them afterwards.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Capacity</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                className="font-number"
                disabled={!can.overrideCapacityAndPrice}
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Minimum group size</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={0}
                value={minimumGroupSize}
                onChange={(event) => setMinimumGroupSize(event.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {can.overrideCapacityAndPrice
              ? `${committedSeats} seat${committedSeats === 1 ? "" : "s"} already booked or held — capacity cannot go below that.`
              : "Your role cannot change the capacity."}
          </p>

          {can.overrideCapacityAndPrice && (
            <>
              <Separator />
              <SectionHeading
                title="Pricing"
                act={
                  pricing.priceSource === "OVERRIDDEN" ? (
                    <span className={`text-[11px] ${TONE_TEXT.warning}`}>
                      Repriced from template
                    </span>
                  ) : undefined
                }
              />
              <p className="text-[11px] text-muted-foreground -mt-2">
                This departure&apos;s own price — independent of the package
                template and of every other group created from it. Existing
                bookings keep the price they were made at; this only changes
                what new bookings are offered.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    Quad price
                  </label>
                  <ButtonGroup className="w-full items-center">
                    <InputGroupInput
                      value={pricing.currency}
                      readOnly
                      className="flex-1"
                    />
                    <CurrencyInput
                      inputMode="numeric"
                      min={0}
                      value={quadPrice === "" ? 0 : parseInt(quadPrice)}
                      onValueChange={(val) => setQuadPrice(String(val))}
                      className="font-number flex-6"
                    />
                  </ButtonGroup>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    Triple price
                  </label>
                  <ButtonGroup className="w-full items-center">
                    <InputGroupInput
                      value={pricing.currency}
                      readOnly
                      className="flex-1"
                    />
                    <CurrencyInput
                      inputMode="numeric"
                      min={0}
                      value={triplePrice === "" ? 0 : parseInt(triplePrice)}
                      onValueChange={(val) => setTriplePrice(String(val))}
                      className="font-number flex-6"
                    />
                  </ButtonGroup>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    Double price
                  </label>
                  <ButtonGroup className="w-full items-center">
                    <InputGroupInput
                      value={pricing.currency}
                      readOnly
                      className="flex-1"
                    />
                    <CurrencyInput
                      inputMode="numeric"
                      min={0}
                      value={doublePrice === "" ? 0 : parseInt(doublePrice)}
                      onValueChange={(val) => setDoublePrice(String(val))}
                      className="font-number flex-6"
                    />
                  </ButtonGroup>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    Single price
                  </label>
                  <ButtonGroup className="w-full items-center">
                    <InputGroupInput
                      value={pricing.currency}
                      readOnly
                      className="flex-1"
                    />
                    <CurrencyInput
                      inputMode="numeric"
                      min={0}
                      value={singlePrice === "" ? 0 : parseInt(singlePrice)}
                      onValueChange={(val) => setSinglePrice(String(val))}
                      className="font-number flex-6"
                    />
                  </ButtonGroup>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">
                  Advance deposit
                </label>
                <ButtonGroup className="w-full items-center">
                  <InputGroupInput
                    value={pricing.currency}
                    readOnly
                    className="flex-1"
                  />
                  <CurrencyInput
                    inputMode="numeric"
                    min={0}
                    value={advanceDeposit === "" ? 0 : parseInt(advanceDeposit)}
                    onValueChange={(val) => setAdvanceDeposit(String(val))}
                    className="font-number flex-6"
                  />
                </ButtonGroup>
              </div>
              {pricing.quadPrice !== null && (
                <p className="text-[11px] text-muted-foreground">
                  Current quad price:{" "}
                  {formatExactCurrency(pricing.quadPrice, pricing.currency)}
                </p>
              )}

              <Separator />
              <SectionHeading title="Departure costs" />
              <p className="text-[11px] text-muted-foreground -mt-2">
                Costs that do not shrink when the group is smaller — a coach,
                a guide&apos;s fee, ground handling. This is on top of the
                per-pilgrim cost estimate copied from the package template.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">
                  Fixed cost per departure
                </label>
                <ButtonGroup className="w-full items-center">
                  <InputGroupInput
                    value={pricing.currency}
                    readOnly
                    className="flex-1"
                  />
                  <CurrencyInput
                    inputMode="numeric"
                    min={0}
                    value={
                      fixedCostPerDeparture === ""
                        ? 0
                        : parseInt(fixedCostPerDeparture)
                    }
                    onValueChange={(val) =>
                      setFixedCostPerDeparture(String(val))
                    }
                    className="font-number flex-6"
                  />
                </ButtonGroup>
              </div>
              {costing && (
                <p className="text-[11px] text-muted-foreground">
                  Break-even:{" "}
                  {costing.breakEvenHeadcount === null
                    ? "not reachable at the current price"
                    : `${costing.breakEvenHeadcount} seats`}{" "}
                  · Est. margin at {costing.confirmedPax} confirmed:{" "}
                  {formatExactCurrency(
                    costing.estimatedGrossMargin,
                    pricing.currency,
                  )}
                </p>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Sales status</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      className="cursor-pointer"
                      value={SALES_STATUS_LABELS[salesStatus]}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-48">
                  {SALES_STATUSES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setSalesStatus(option)}
                    >
                      {SALES_STATUS_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Seat hold expiry (hours)</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={1}
                value={seatHoldExpiryHours}
                onChange={(event) => setSeatHoldExpiryHours(event.target.value)}
                className="font-number"
              />
            </InputGroup>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-sm bg-muted/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Waitlist</p>
              <p className="text-[11px] text-muted-foreground">
                Accept bookings once every seat is sold.
              </p>
            </div>
            <Switch
              checked={waitlistEnabled}
              onCheckedChange={setWaitlistEnabled}
            />
          </div>

          <Separator />

          <p className="text-xs font-medium text-foreground">Owners</p>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Operations owner</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={operationsOwnerName}
                onChange={(event) => setOperationsOwnerName(event.target.value)}
                placeholder="Unassigned"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Primary guide</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={primaryGuideName}
                onChange={(event) => setPrimaryGuideName(event.target.value)}
                placeholder="Unassigned"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Visa owner</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={visaOwnerName}
                onChange={(event) => setVisaOwnerName(event.target.value)}
                placeholder="Unassigned"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Finance owner</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={financeOwnerName}
                onChange={(event) => setFinanceOwnerName(event.target.value)}
                placeholder="Unassigned"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Local coordinator</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={localCoordinatorName}
                onChange={(event) =>
                  setLocalCoordinatorName(event.target.value)
                }
                placeholder="Not appointed"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Coordinator phone</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={localCoordinatorPhone}
                onChange={(event) =>
                  setLocalCoordinatorPhone(event.target.value)
                }
                className="font-number"
                placeholder="—"
              />
            </InputGroup>
          </div>

          {can.manageDocumentsAndVisa && (
            <>
              <Separator />
              <SectionHeading title="Nusuk / visa batch" />
              <p className="text-[11px] text-muted-foreground -mt-2">
                The Masar Nusuk identifiers this departure is submitted under.
                This is a group-level batch gate — it does not change any
                individual pilgrim&apos;s visa status.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Umrah company</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={umrahCompanyName}
                    onChange={(event) => setUmrahCompanyName(event.target.value)}
                    placeholder="Not contracted"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Nusuk program ref</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={nusukProgramRef}
                    onChange={(event) => setNusukProgramRef(event.target.value)}
                    className="font-number"
                    placeholder="—"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Nusuk group ref</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={nusukGroupRef}
                    onChange={(event) => setNusukGroupRef(event.target.value)}
                    className="font-number"
                    placeholder="—"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Visa batch ref</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={visaBatchRef}
                    onChange={(event) => setVisaBatchRef(event.target.value)}
                    className="font-number"
                    placeholder="—"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Visa invoice ref</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={visaInvoiceRef}
                    onChange={(event) => setVisaInvoiceRef(event.target.value)}
                    className="font-number"
                    placeholder="—"
                  />
                </InputGroup>
                <div className="flex flex-col gap-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Nusuk status</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          value={NUSUK_STATUS_LABELS[nusukStatus]}
                          readOnly
                          className="cursor-pointer"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {NUSUK_STATUSES.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          onClick={() => setNusukStatus(status)}
                        >
                          {NUSUK_STATUS_LABELS[status]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border/40">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={isPending || groupName.trim().length < 3}
              onClick={submit}
            >
              {isPending && <Loader2 className="animate-spin" />}
              Save Changes
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default EditGroupDetailsSheet;
