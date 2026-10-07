"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { ChevronDown, Link2, Link2Off } from "lucide-react";
import React, { useEffect, useState } from "react";

import {
  CURRENCY_LABELS,
  SERVICE_CATEGORY_LABELS,
} from "@/lib/data/suppliers-copy";
import {
  createCommitmentAction,
  listGroupLinkableEntitiesAction,
} from "../actions";
import type { GroupPickerOption } from "../suppliers-store";
import { DateTimePicker } from "@/components/date-time-picker";
import { ButtonGroup } from "@/components/ui/button-group";

/** Which linked-entity type (if any) a service category implies — see `loadGroupLinkableEntities()`. FLIGHT is out of scope here, matching `createCommitment()`'s own cost-sync (ACCOMMODATION/TRANSPORT only). */
const LINK_TYPE_BY_CATEGORY: Record<
  string,
  "ACCOMMODATION" | "TRANSPORT" | null
> = {
  MAKKAH_ACCOMMODATION: "ACCOMMODATION",
  MADINAH_ACCOMMODATION: "ACCOMMODATION",
  ACCOMMODATION_OTHER: "ACCOMMODATION",
  AIRPORT_TRANSFER: "TRANSPORT",
  INTERCITY_TRANSPORT: "TRANSPORT",
  ZIYARAH_TRANSPORT: "TRANSPORT",
  CATERING: null,
  TICKETING: null,
  VISA_SERVICE: null,
  INSURANCE: null,
  GUIDE_SERVICE: null,
  ANCILLARY: null,
  OTHER: null,
};

export interface CreateCommitmentSupplierRef {
  id: string;
  name: string;
  currency: string;
}

interface CreateCommitmentSheetProps {
  supplier: CreateCommitmentSupplierRef | null;
  groupOptions: GroupPickerOption[];
  canViewCosts: boolean;
  open: boolean;
  onClose: () => void;
}

const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS);
const CURRENCIES = Object.keys(CURRENCY_LABELS).filter((c) => c !== "OTHER");

/**
 * Shared "Create Commitment" form — launched from the supplier list, the
 * supplier profile, and (later) a Departure Group's Hotels/Transport/Flights
 * tab. Creating a commitment never confirms it: confirmation requires
 * evidence and a booking reference, gated separately.
 */
export default function CreateCommitmentSheet({
  supplier,
  groupOptions,
  canViewCosts,
  open,
  onClose,
}: CreateCommitmentSheetProps) {
  const [departureGroupId, setDepartureGroupId] = useState("");
  const [serviceCategory, setServiceCategory] = useState(
    "MAKKAH_ACCOMMODATION",
  );
  const [serviceLabel, setServiceLabel] = useState("");
  const [serviceDetails, setServiceDetails] = useState("");
  const [serviceStartDate, setServiceStartDate] = useState("");
  const [serviceEndDate, setServiceEndDate] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [currency, setCurrency] = useState("SAR");
  const [notes, setNotes] = useState("");
  const [linkedEntityId, setLinkedEntityId] = useState<string | null>(null);
  const [linkableAccommodations, setLinkableAccommodations] = useState<
    { id: string; label: string }[]
  >([]);
  const [linkableTransports, setLinkableTransports] = useState<
    { id: string; label: string }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDepartureGroupId(groupOptions[0]?.id ?? "");
    setServiceCategory("MAKKAH_ACCOMMODATION");
    setServiceLabel("");
    setServiceDetails("");
    setServiceStartDate("");
    setServiceEndDate("");
    setBookingReference("");
    setOwnerName("");
    setAmount("");
    setCurrency(
      supplier?.currency && supplier.currency !== "OTHER"
        ? supplier.currency
        : "SAR",
    );
    setNotes("");
    setLinkedEntityId(null);
    setLinkableAccommodations([]);
    setLinkableTransports([]);
    setError(null);
  };

  useResetOnOpen(open, supplier?.id ?? "", reset);

  // Re-fetch the group's linkable rows whenever the chosen group changes —
  // the picker only ever offers this group's own hotels/routes. Clearing
  // `linkedEntityId` happens where the group is actually picked (below),
  // not here, so this effect only ever synchronizes with the fetch.
  useEffect(() => {
    if (!open || !departureGroupId) return;
    listGroupLinkableEntitiesAction(departureGroupId).then((res) => {
      if (res.ok) {
        setLinkableAccommodations(res.accommodations);
        setLinkableTransports(res.transports);
      }
    });
  }, [open, departureGroupId]);

  if (!supplier) return null;

  const selectedGroup = groupOptions.find((g) => g.id === departureGroupId);
  const linkType = LINK_TYPE_BY_CATEGORY[serviceCategory] ?? null;
  const linkOptions =
    linkType === "ACCOMMODATION"
      ? linkableAccommodations
      : linkType === "TRANSPORT"
        ? linkableTransports
        : [];
  const selectedLink = linkOptions.find((o) => o.id === linkedEntityId);

  const submit = async () => {
    setSubmitting(true);
    const result = await createCommitmentAction({
      supplierId: supplier.id,
      departureGroupId,
      serviceCategory,
      serviceLabel: serviceLabel || SERVICE_CATEGORY_LABELS[serviceCategory],
      serviceDetails,
      serviceStartDate: serviceStartDate || null,
      serviceEndDate: serviceEndDate || null,
      bookingReference,
      status: "REQUESTED",
      linkedEntityType: linkType && linkedEntityId ? linkType : null,
      linkedEntityId: linkType ? linkedEntityId : null,
      ownerName,
      amount: amount === "" ? null : amount,
      currency,
      notes,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the commitment.");
      return;
    }
    toast.add({
      title: "Commitment created",
      description: `${supplier.name} — ${SERVICE_CATEGORY_LABELS[serviceCategory]}.`,
    });
    onClose();
  };

  const canSubmit = departureGroupId.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="md:min-w-xl custom-scroll gap-0">
        <SheetHeader>
          <SheetTitle>Add Commitment</SheetTitle>
          <SheetDescription>
            {supplier.name} — record one service promise to a Departure Group.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col overflow-y-auto custom-scroll gap-3 px-4 py-4">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Departure Group *</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={
                    selectedGroup
                      ? `${selectedGroup.groupName} (${selectedGroup.groupCode})`
                      : "Choose a group"
                  }
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-72 max-h-72 overflow-y-auto custom-scroll"
            >
              {groupOptions.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => {
                    setDepartureGroupId(g.id);
                    setLinkedEntityId(null);
                  }}
                >
                  {g.groupName} ({g.groupCode})
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Service Type *</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={SERVICE_CATEGORY_LABELS[serviceCategory]}
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-56 max-h-72 overflow-y-auto custom-scroll"
            >
              {SERVICE_CATEGORIES.map((category) => (
                <DropdownMenuItem
                  key={category}
                  onClick={() => {
                    setServiceCategory(category);
                    setLinkedEntityId(null);
                  }}
                >
                  {SERVICE_CATEGORY_LABELS[category]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {linkType && (
            <div className="flex flex-col gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup className="cursor-pointer">
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Link to</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={
                        selectedLink?.label ?? "Not linked to an existing row"
                      }
                      className={
                        selectedLink
                          ? "cursor-pointer"
                          : "cursor-pointer text-muted-foreground"
                      }
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-72 max-h-64 overflow-y-auto custom-scroll"
                >
                  {linkedEntityId && (
                    <DropdownMenuItem
                      onClick={() => setLinkedEntityId(null)}
                      className="text-muted-foreground"
                    >
                      <Link2Off className="size-3.5" /> Clear link
                    </DropdownMenuItem>
                  )}
                  {linkOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground max-w-72">
                      {selectedGroup
                        ? `${selectedGroup.groupName} has no unlinked ${linkType === "ACCOMMODATION" ? "hotels" : "transport routes"} yet.`
                        : "Choose a departure group first."}
                    </div>
                  ) : (
                    linkOptions.map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onClick={() => setLinkedEntityId(o.id)}
                      >
                        {linkedEntityId === o.id && (
                          <Link2 className="size-3.5" />
                        )}
                        {o.label}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-[11px] text-muted-foreground">
                Linking pushes this supplier onto that hotel/route, and keeps
                its confirmed status in step.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <DateTimePicker
              label="Service Start"
              required
              value={serviceStartDate}
              onChange={setServiceStartDate}
            />
            <DateTimePicker
              label="Service End"
              required
              value={serviceEndDate}
              onChange={setServiceEndDate}
            />
          </div>

          <Field label="Service Details">
            <InputGroupTextarea
              value={serviceDetails}
              onChange={(e) => setServiceDetails(e.target.value)}
              placeholder="Pullman ZamZam Makkah · 10 rooms · Quad/Triple allocation"
            />
          </Field>

          <Field label="Booking Reference">
            <InputGroupInput
              value={bookingReference}
              onChange={(e) => setBookingReference(e.target.value)}
              placeholder="HTL-MAK-882"
            />
          </Field>

          <Field label="Operations Owner">
            <InputGroupInput
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="M. Rameez"
            />
          </Field>

          {canViewCosts && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier Cost">
                <ButtonGroup>
                  <InputGroupText className="tabular-nums">LKR</InputGroupText>
                  <CurrencyInput value={amount} onValueChange={setAmount} />
                </ButtonGroup>
              </Field>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup className="cursor-pointer">
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Currency</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      readOnly
                      value={currency}
                      className="cursor-pointer"
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {CURRENCIES.map((c) => (
                    <DropdownMenuItem key={c} onClick={() => setCurrency(c)}>
                      {c}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <Field label="Notes">
            <InputGroupTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this commitment…"
            />
          </Field>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting ? "Creating…" : "Create Commitment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <InputGroup>
      <InputGroupAddon align={"block-start"}>
        <InputGroupText>{label}</InputGroupText>
      </InputGroupAddon>
      {children}
    </InputGroup>
  );
}
