"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/input-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SidebarStepperDialogBody,
  type SidebarStepperStep,
} from "@/components/ui/sidebar-stepper-dialog-body";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  createDepartureGroupSchema,
  toDepartureGroupFieldErrors,
  type DepartureGroupFieldErrors,
} from "@/lib/validations/departure-groups";
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useMemo, useState, useTransition } from "react";

import {
  createDepartureGroupAction,
  generateGroupCodeAction,
} from "../actions";
import type {
  GroupSalesStatus,
  PackageTemplateOption,
  TemplateCopyOptions,
} from "../types";
import {
  JOURNEY_TYPE_LABELS,
  SALES_STATUS_LABELS,
  formatExactCurrency,
} from "../utils";
import {
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
  type Tone,
} from "@/lib/ui/tone";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { addDays, format } from "date-fns";
import SearchInput from "@/components/ui/search-input";
import { ButtonGroup } from "@/components/ui/button-group";
import { CurrencyInput } from "@/components/ui/currency-input";
import SectionHeading from "@/components/section-heading";

const COPY_LABELS: { key: keyof TemplateCopyOptions; label: string }[] = [
  { key: "itinerary", label: "Journey itinerary" },
  { key: "inclusionsAndExclusions", label: "Inclusions and exclusions" },
  { key: "travellerRequirements", label: "Traveller requirements" },
  { key: "readinessChecklist", label: "Readiness checklist" },
  { key: "accommodation", label: "Accommodation requirements" },
  { key: "transport", label: "Transport requirements" },
  { key: "flights", label: "Flight routing (2 draft flights)" },
];

const DEFAULT_COPY: TemplateCopyOptions = {
  itinerary: true,
  inclusionsAndExclusions: true,
  travellerRequirements: true,
  readinessChecklist: true,
  accommodation: true,
  transport: true,
  flights: true,
};

const SALES_STATUSES: GroupSalesStatus[] = [
  "SELLING",
  "LIMITED_AVAILABILITY",
  "WAITLIST",
  "SALES_CLOSED",
];

const SEAT_HOLD_CHOICES = [6, 12, 24, 48];

/** The form works with `Date` objects; the schema and server want `yyyy-MM-dd`. */
const toIsoDate = (date: Date) => format(date, "yyyy-MM-dd");

interface FormState {
  groupName: string;
  groupCode: string;
  departureDate: Date;
  returnDate: Date;
  capacity: string;
  minimumGroupSize: string;
  salesStatus: GroupSalesStatus;
  branch: string;
  operationsOwnerName: string;
  primaryGuideName: string;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;
}

/**
 * This departure's own commercial facts — a template carries none of these
 * (see docs/architecture/package-departure-architecture-master-plan.md), so they are
 * always entered fresh per group, never defaulted from the template.
 */
interface PricingState {
  currency: string;
  quadPrice: number | "";
  triplePrice: number | "";
  doublePrice: number | "";
  singlePrice: number | "";
  childPrice: number | "";
  infantPrice: number | "";
  earlyBirdPrice: number | "";
  advanceDeposit: number | "";
}

interface CostEstimateState {
  flightCostPerPilgrim: string;
  accommodationCostPerPilgrim: string;
  transportCostPerPilgrim: string;
  visaInsuranceCostPerPilgrim: string;
  cateringCostPerPilgrim: string;
  guideOperationsCostPerPilgrim: string;
  contingencyCostPerPilgrim: string;
  fixedCostPerDeparture: string;
}

interface FlightRoutingState {
  flightsIncluded: boolean;
  departureOrigin: string;
  arrivalGateway: string;
  returnGateway: string;
  preferredAirline: string;
  cabinClass: string;
}

const DEFAULT_PRICING: PricingState = {
  currency: "LKR",
  quadPrice: "",
  triplePrice: "",
  doublePrice: "",
  singlePrice: "",
  childPrice: "",
  infantPrice: "",
  earlyBirdPrice: "",
  advanceDeposit: "",
};

const DEFAULT_COST_ESTIMATE: CostEstimateState = {
  flightCostPerPilgrim: "",
  accommodationCostPerPilgrim: "",
  transportCostPerPilgrim: "",
  visaInsuranceCostPerPilgrim: "",
  cateringCostPerPilgrim: "",
  guideOperationsCostPerPilgrim: "",
  contingencyCostPerPilgrim: "",
  fixedCostPerDeparture: "0",
};

const DEFAULT_FLIGHT_ROUTING: FlightRoutingState = {
  flightsIncluded: true,
  departureOrigin: "",
  arrivalGateway: "",
  returnGateway: "",
  preferredAirline: "",
  cabinClass: "Economy",
};

/** `""` → `null`, `number` → itself, string → parsed — the shape every
 * price/cost field on the server expects. Accepts `number | ""` (PricingState)
 * and plain `string` (CostEstimateState) so both can share this helper. */
const toNullableNumber = (value: number | string | ""): number | null => {
  if (typeof value === "number") return value;
  return value.trim() === "" ? null : Number(value);
};

const STEPS: SidebarStepperStep[] = [
  {
    id: "template",
    label: "Select Template",
    description: "Choose the package to copy from",
  },
  {
    id: "details",
    label: "Group Details",
    description: "Name, dates, capacity & owner",
  },
  {
    id: "pricing",
    label: "Pricing & Flights",
    description: "Price, cost estimate & routing",
  },
];

interface CreateDepartureGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PackageTemplateOption[];
  role: StaffRole;
  branches: string[];
  /**
   * Preselects a template when the dialog opens — used by the "Create
   * Departure Group" deep link from the Packages list/detail screens
   * (`/departure-groups?create=1&template=<id>`), which previously landed
   * on the plain group list with the chosen package ignored entirely. See
   * docs/modules/packages-production-readiness-plan.md, finding C4.
   */
  initialTemplateId?: string | null;
}

/**
 * Three focused steps in a Dialog, not another seven-step wizard: pick the
 * template, confirm the handful of facts that are genuinely group-specific,
 * then set this departure's own price, cost and flights. Everything else is
 * copied.
 */
const CreateDepartureGroupDialog = ({
  open,
  onOpenChange,
  templates,
  role,
  branches,
  initialTemplateId = null,
}: CreateDepartureGroupDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Slide direction is decided when the user navigates, not read from a ref.
  const [direction, setDirection] = useState(1);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ADMIN-only: Draft packages are already excluded from `templates` for
  // every other role server-side (`listPackageTemplateOptions({
  // includeDrafts: role === "ADMIN" })`), so this toggle has nothing to
  // reveal for anyone else. Off by default — only Open for Sale packages
  // are offered unless explicitly asked for. See finding C3/E-adjacent UX
  // note in docs/modules/packages-production-readiness-plan.md, Phase 2 item 7.
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [copyOptions, setCopyOptions] =
    useState<TemplateCopyOptions>(DEFAULT_COPY);
  const [errors, setErrors] = useState<DepartureGroupFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isGeneratingCode, startCodeGenTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    groupName: "",
    groupCode: "",
    departureDate: new Date(),
    returnDate: new Date(),
    capacity: "",
    minimumGroupSize: "",
    salesStatus: "SELLING",
    branch: branches[0] ?? "Colombo",
    operationsOwnerName: "",
    primaryGuideName: "",
    waitlistEnabled: true,
    seatHoldExpiryHours: 24,
  });
  const [pricing, setPricing] = useState<PricingState>(DEFAULT_PRICING);
  const [costEstimate, setCostEstimate] = useState<CostEstimateState>(
    DEFAULT_COST_ESTIMATE,
  );
  const [flightRouting, setFlightRouting] = useState<FlightRoutingState>(
    DEFAULT_FLIGHT_ROUTING,
  );

  const selected = templates.find((template) => template.id === selectedId);

  /**
   * Quad price is the group's list price everywhere downstream (the costing
   * view, the Overview tab, `groupPrice()`'s fallback) — leaving it blank was
   * previously accepted by this form, so a group could be created with no
   * price at all and only be noticed missing after the fact, on the group's
   * own Pricing tab. Gate the final step on it instead of on the schema (the
   * schema also serves CSV bulk-import, which legitimately has no price data
   * to give yet).
   */
  const quadPriceValue = toNullableNumber(pricing.quadPrice);
  const quadPriceMissing = quadPriceValue === null || quadPriceValue <= 0;
  const advanceDepositValue = toNullableNumber(pricing.advanceDeposit);
  const depositExceedsPrice =
    advanceDepositValue !== null &&
    quadPriceValue !== null &&
    advanceDepositValue > quadPriceValue;

  /** Live margin preview — the same shape as the `departure_group_costing`
   * view's math, minus the "actual supplier cost" and confirmed-pax terms
   * that only exist once bookings do. See migration
   * `20260909090000_departure_group_costing.sql`. */
  const costPerPax =
    (toNullableNumber(costEstimate.flightCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.accommodationCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.transportCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.visaInsuranceCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.cateringCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.guideOperationsCostPerPilgrim) ?? 0) +
    (toNullableNumber(costEstimate.contingencyCostPerPilgrim) ?? 0);
  const fixedCostPerDeparture = Number(costEstimate.fixedCostPerDeparture) || 0;
  const marginPerPax =
    quadPriceValue !== null ? quadPriceValue - costPerPax : null;
  const marginPercent =
    marginPerPax !== null && quadPriceValue
      ? (marginPerPax / quadPriceValue) * 100
      : null;
  const breakEvenHeadcount =
    marginPerPax !== null && marginPerPax > 0
      ? Math.ceil(fixedCostPerDeparture / marginPerPax)
      : null;
  const capacityValue = Number(form.capacity) || 0;
  const marginTone: Tone =
    marginPercent === null
      ? "neutral"
      : marginPercent >= 15
        ? "success"
        : marginPercent > 0
          ? "warning"
          : "danger";
  const marginBadge = {
    label:
      marginPercent === null
        ? "Enter a quad price and cost estimate to see margin"
        : marginPercent >= 15
          ? `Healthy margin (${marginPercent.toFixed(1)}%)`
          : marginPercent > 0
            ? `Below 15% threshold (${marginPercent.toFixed(1)}%)`
            : `Selling at a loss (${marginPercent.toFixed(1)}%)`,
    color: TONE_CLASS[marginTone],
  };

  const branchChoices = branches.length > 0 ? branches : ["Colombo", "Kandy"];

  const filteredTemplates = useMemo(() => {
    const scoped = includeDrafts
      ? templates
      : templates.filter(
          (template) => template.isOpenForSale || template.id === selectedId,
        );
    const needle = templateSearch.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter((template) =>
      [
        template.name,
        template.code,
        template.category,
        JOURNEY_TYPE_LABELS[template.journeyType],
        template.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [templates, templateSearch, includeDrafts, selectedId]);

  /** Duration always comes from the group's real dates, never the template. */
  const actualDurationDays = useMemo(() => {
    if (!form.departureDate || !form.returnDate) return null;
    const days =
      Math.round(
        (Date.parse(`${toIsoDate(form.returnDate)}T00:00:00Z`) -
          Date.parse(`${toIsoDate(form.departureDate)}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    return days > 0 ? days : null;
  }, [form.departureDate, form.returnDate]);

  const durationLabel = useMemo(() => {
    if (actualDurationDays === null) return null;
    return `${actualDurationDays} days / ${Math.max(actualDurationDays - 1, 0)} nights`;
  }, [actualDurationDays]);

  /**
   * Flags when the dates actually picked don't match the template's own
   * length — the accommodation blocks `buildAccommodations()` seeds are
   * laid out from the template's `makkah_nights`/`madinah_nights`
   * regardless of the group's real span, so a 15-day group built from an
   * 11-day template gets hotel check-out dates that land on day 11, with
   * nothing said about the other 4 days. This can't fix that layout by
   * itself (accommodation still needs a human to adjust it on the group
   * once created), but it is at least surfaced before creation instead of
   * discovered afterwards. See docs/modules/packages-production-readiness-plan.md,
   * Phase 2 item 6.
   */
  const durationMismatch =
    selected &&
    actualDurationDays !== null &&
    actualDurationDays !== selected.durationDays
      ? actualDurationDays
      : null;

  const reset = () => {
    setStep(1);
    setDirection(1);
    setSelectedId(null);
    setTemplateSearch("");
    setIncludeDrafts(false);
    setCopyOptions(DEFAULT_COPY);
    setErrors({});
    setFormError(null);
    setForm({
      groupName: "",
      groupCode: "",
      departureDate: new Date(),
      returnDate: new Date(),
      capacity: "",
      minimumGroupSize: "",
      salesStatus: "SELLING",
      branch: branchChoices[0],
      operationsOwnerName: "",
      primaryGuideName: "",
      waitlistEnabled: true,
      seatHoldExpiryHours: 24,
    });
    setPricing(DEFAULT_PRICING);
    setCostEstimate(DEFAULT_COST_ESTIMATE);
    setFlightRouting(DEFAULT_FLIGHT_ROUTING);
  };

  const chooseTemplate = (template: PackageTemplateOption) => {
    setSelectedId(template.id);
    // Seed the group with the template's defaults; they stay editable. The
    // return date is pre-filled from the template's own length
    // (`departure + days − 1`) rather than left at whatever the form
    // already held — previously it stayed at its untouched default
    // (same-day as departure) until the creator noticed and fixed it by
    // hand, and nothing ever flagged the mismatch either way. See
    // docs/modules/packages-production-readiness-plan.md, Phase 2 item 6.
    setForm((prev) => ({
      ...prev,
      capacity: String(template.defaultCapacity),
      minimumGroupSize: String(template.minGroupSize),
      waitlistEnabled: template.waitlistEnabled,
      seatHoldExpiryHours: template.seatHoldExpiryHours,
      returnDate: addDays(
        prev.departureDate,
        Math.max(template.durationDays - 1, 0),
      ),
    }));
  };

  // Deep-link preselect (see `initialTemplateId`'s own comment above).
  // Adjusted during render rather than in an effect — this dialog is
  // deliberately kept mounted across opens/closes once first opened (see
  // `hasOpenedCreate` in the parent list), so `open` flipping true again is
  // a prop change on an existing instance, which is exactly the case
  // React's docs recommend handling by adjusting state directly during
  // render instead of in a `useEffect`
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // `appliedDeepLinkFor` remembers which open+id pair was already applied,
  // so this fires once per genuinely new deep link rather than on every
  // render while the dialog stays open, and never re-stomps whatever the
  // user has since picked by hand.
  const [appliedDeepLinkFor, setAppliedDeepLinkFor] = useState<string | null>(
    null,
  );
  const deepLinkKey = open && initialTemplateId ? initialTemplateId : null;
  if (deepLinkKey && deepLinkKey !== appliedDeepLinkFor) {
    setAppliedDeepLinkFor(deepLinkKey);
    const match = templates.find((template) => template.id === deepLinkKey);
    if (match) {
      if (!match.isOpenForSale) setIncludeDrafts(true);
      chooseTemplate(match);
    }
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  /**
   * Suggests a fresh group code whenever the template or departure date
   * changes — the field is read-only, so this is the only way it fills in.
   * Uniqueness is still re-checked against the store at submit time.
   */
  useEffect(() => {
    if (!selected) return;
    const journeyType = selected.journeyType;
    const departureDate = toIsoDate(form.departureDate);

    startCodeGenTransition(async () => {
      const result = await generateGroupCodeAction({
        journeyType,
        departureDate,
      });
      if (result.ok) setField("groupCode", result.code);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, form.departureDate]);

  const submit = () => {
    if (!selected) return;
    setFormError(null);

    if (quadPriceMissing) {
      setFormError(
        "Enter a Quad occupancy price — a departure group cannot be created without its own price.",
      );
      return;
    }
    if (depositExceedsPrice) {
      setFormError("Advance deposit cannot exceed the Quad price.");
      return;
    }

    const payload = {
      packageTemplateId: selected.id,
      groupName: form.groupName,
      groupCode: form.groupCode,
      departureDate: toIsoDate(form.departureDate),
      returnDate: toIsoDate(form.returnDate),
      capacity: Number(form.capacity),
      minimumGroupSize: Number(form.minimumGroupSize || 0),
      salesStatus: form.salesStatus,
      branch: form.branch,
      operationsOwnerName: form.operationsOwnerName,
      primaryGuideName: form.primaryGuideName,
      waitlistEnabled: form.waitlistEnabled,
      seatHoldExpiryHours: form.seatHoldExpiryHours,
      copyOptions,
      // Admin-only escape hatch, re-checked in the Server Action.
      allowDraftTemplate: !selected.isOpenForSale,
      pricing: {
        currency: pricing.currency,
        quadPrice: toNullableNumber(pricing.quadPrice),
        triplePrice: toNullableNumber(pricing.triplePrice),
        doublePrice: toNullableNumber(pricing.doublePrice),
        singlePrice: toNullableNumber(pricing.singlePrice),
        childPrice: toNullableNumber(pricing.childPrice),
        infantPrice: toNullableNumber(pricing.infantPrice),
        earlyBirdPrice: toNullableNumber(pricing.earlyBirdPrice),
        advanceDeposit: toNullableNumber(pricing.advanceDeposit),
      },
      costEstimate: {
        flightCostPerPilgrim: toNullableNumber(
          costEstimate.flightCostPerPilgrim,
        ),
        accommodationCostPerPilgrim: toNullableNumber(
          costEstimate.accommodationCostPerPilgrim,
        ),
        transportCostPerPilgrim: toNullableNumber(
          costEstimate.transportCostPerPilgrim,
        ),
        visaInsuranceCostPerPilgrim: toNullableNumber(
          costEstimate.visaInsuranceCostPerPilgrim,
        ),
        cateringCostPerPilgrim: toNullableNumber(
          costEstimate.cateringCostPerPilgrim,
        ),
        guideOperationsCostPerPilgrim: toNullableNumber(
          costEstimate.guideOperationsCostPerPilgrim,
        ),
        contingencyCostPerPilgrim: toNullableNumber(
          costEstimate.contingencyCostPerPilgrim,
        ),
        fixedCostPerDeparture: Number(costEstimate.fixedCostPerDeparture) || 0,
      },
      flightRouting: {
        flightsIncluded: flightRouting.flightsIncluded,
        departureOrigin: flightRouting.departureOrigin,
        arrivalGateway: flightRouting.arrivalGateway,
        returnGateway: flightRouting.returnGateway,
        preferredAirline: flightRouting.preferredAirline,
        cabinClass: flightRouting.cabinClass,
      },
    };

    // Run the same schema client-side first so errors land on the fields.
    const parsed = createDepartureGroupSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(toDepartureGroupFieldErrors(parsed.error));
      setFormError("Check the highlighted fields and try again.");
      return;
    }

    startTransition(async () => {
      const result = await createDepartureGroupAction(payload);

      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) setErrors(result.fieldErrors);
        return;
      }

      toast.add({
        title: "Departure Group created",
        description: `Departure Group created from ${result.packageName}.`,
      });
      onOpenChange(false);
      reset();
      router.push(`/departure-groups/${result.groupId}`);
      router.refresh();
    });
  };

  const fieldError = (key: string) => errors[key]?.[0];

  // Whether each step's own requirements are met (index 0 = step 1).
  const stepIsValid = [
    Boolean(selected) && (selected?.isOpenForSale || role === "ADMIN"),
    Boolean(form.groupName.trim()) && Boolean(form.capacity),
    !quadPriceMissing && !depositExceedsPrice,
  ];

  const goToStep = (index: number) => {
    setDirection(index >= step - 1 ? 1 : -1);
    setStep((index + 1) as 1 | 2 | 3);
  };

  const closeAndReset = () => {
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="p-0! gap-0! w-full max-w-full! h-dvh flex flex-col overflow-hidden md:max-w-3xl! md:h-[90vh] lg:max-w-6xl!"
      >
        <DialogTitle className="sr-only">Create Departure Group</DialogTitle>
        <DialogDescription className="sr-only">
          Create a live group from a Package Template
        </DialogDescription>

        <SidebarStepperDialogBody
          title="Create Departure Group"
          subtitle="Create a live group from a Package Template. Defaults are copied and can be adjusted."
          steps={STEPS}
          activeStep={step - 1}
          direction={direction}
          onStepSelect={goToStep}
          getStepState={(index) => ({
            isLocked: stepIsValid.slice(0, index).some((valid) => !valid),
            isCompleted: index < step - 1 && stepIsValid[index],
          })}
          onCancel={closeAndReset}
          onBack={() => goToStep(step - 2)}
          onContinue={() => goToStep(step)}
          canContinue={stepIsValid[step - 1]}
          footerHint={
            step === 1 ? (
              <span className="hidden sm:inline text-xs text-muted-foreground">
                {templates.length} template{templates.length === 1 ? "" : "s"}{" "}
                available
              </span>
            ) : null
          }
          lastStepAction={
            <Button disabled={isPending || !stepIsValid[2]} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              Create Departure Group
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {step === 1 ? (
              <>
                {templates.length > 0 && (
                  <SearchInput
                    value={templateSearch}
                    onChange={(value) => {
                      setTemplateSearch(value);
                    }}
                    placeholder={
                      "Search package templates by name, code, type, or season..."
                    }
                  />
                )}

                {role === "ADMIN" &&
                  templates.some((t) => !t.isOpenForSale) && (
                    <Card className="flex flex-row items-center justify-between shadow-xs! px-4 py-2 bg-muted/30">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Include drafts
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Admin-only — a group started from a Draft template can
                          never itself be put on sale.
                        </p>
                      </div>
                      <Switch
                        checked={includeDrafts}
                        onCheckedChange={setIncludeDrafts}
                      />
                    </Card>
                  )}

                <div className="flex flex-col gap-4 mt-2 py-2">
                  {templates.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <p className="text-sm text-muted-foreground">
                        No packages yet. Create a package first, then start a
                        departure group from it.
                      </p>
                      <Button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          router.push("/packages/new");
                        }}
                      >
                        Create Package
                      </Button>
                    </div>
                  ) : filteredTemplates.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No package templates match that search.
                    </p>
                  ) : null}
                  {filteredTemplates.map((template) => {
                    const isSelected = template.id === selectedId;
                    return (
                      <Card
                        key={template.id}
                        onClick={() => chooseTemplate(template)}
                        variant="md-shadow"
                        className={cn(
                          "text-left  hover:cursor-pointer border px-4 py-1.5 transition-colors",
                          isSelected
                            ? "border-primary/10 bg-primary/5"
                            : "border-border/50 hover:bg-muted/50",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {template.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <Badge
                                variant="outline"
                                className="text-xs tabular-nums text-muted-foreground"
                              >
                                {template.code}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {/* {JOURNEY_TYPE_LABELS[template.journeyType]} ·{" "} */}
                                {template.category} · {template.durationLabel}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">
                              Default capacity: {template.defaultCapacity}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <Badge
                              className={cn(
                                "rounded-sm px-2 py-3 text-xs font-normal border-none",
                                template.isOpenForSale
                                  ? TONE_CLASS.success
                                  : TONE_CLASS.neutral,
                              )}
                            >
                              {template.status}
                            </Badge>
                            {!template.isOpenForSale && (
                              <span className="text-[10px] font-number text-muted-foreground">
                                {template.completeness}% complete
                              </span>
                            )}
                            {isSelected && (
                              <Check className="size-4 text-primary" />
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <div className="py-5">
                  {selected && (
                    <Card
                      variant="md-shadow"
                      className="rounded-md   min-h-fit gap-1 px-5 py-5"
                    >
                      <p className="text-sm font-medium text-muted-foreground">
                        Selected Package Template
                      </p>
                      <p className="text-lg font-medium text-foreground mt-0">
                        {selected.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {JOURNEY_TYPE_LABELS[selected.journeyType]} ·{" "}
                        {selected.category} · {selected.durationLabel}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Default capacity: {selected.defaultCapacity}
                      </p>

                      <p className="text-sm mt-4 font-medium text-foreground">
                        This group will copy:
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        The payment schedule structure is copied in. This
                        departure&apos;s own price, cost estimate and flight
                        routing are set on the next step — a template has none
                        of its own.
                      </p>
                      <ul className="mt-1.5 grid gap-1">
                        {COPY_LABELS.map(({ key, label }) => (
                          <li
                            key={key}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <Check
                              className={cn(
                                "size-3.5 shrink-0",
                                TONE_TEXT.success,
                              )}
                            />
                            {label}
                          </li>
                        ))}
                      </ul>

                      {!selected.isOpenForSale && (
                        <div
                          className={cn(
                            "mt-3 flex items-start gap-2 rounded-sm px-2.5 py-2 text-xs",
                            TONE_CLASS.warning,
                          )}
                        >
                          <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                          <span>
                            This template is not open for sale. Only an
                            administrator can create a planning group from it.
                          </span>
                        </div>
                      )}
                    </Card>
                  )}
                </div>
              </>
            ) : step === 2 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Group Name"
                    required
                    error={fieldError("groupName")}
                    className="sm:col-span-2"
                  >
                    <InputGroupInput
                      value={form.groupName}
                      onChange={(e) => setField("groupName", e.target.value)}
                      placeholder="August Umrah Group 04"
                    />
                  </Field>

                  <Field
                    label="Group Code"
                    required
                    error={fieldError("groupCode")}
                    hint={
                      isGeneratingCode
                        ? "Generating a unique code…"
                        : "Generated automatically. Uniqueness is checked again on save."
                    }
                  >
                    <InputGroupInput
                      value={isGeneratingCode ? "Generating…" : form.groupCode}
                      readOnly
                      className="font-number cursor-not-allowed text-muted-foreground"
                    />
                  </Field>

                  <Field label="Branch" required error={fieldError("branch")}>
                    <SelectMenu
                      value={form.branch}
                      options={branchChoices.map((branch) => ({
                        value: branch,
                        label: branch,
                      }))}
                      onChange={(value) => setField("branch", value)}
                    />
                  </Field>
                  <Popover>
                    <PopoverTrigger>
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText>
                            Departure Date{" "}
                            <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          className="cursor-pointer"
                          value={format(form.departureDate, "PPP")}
                        />
                      </InputGroup>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={form.departureDate}
                        onSelect={(date) => {
                          if (!date) return;
                          setField("departureDate", date);
                          // Keep the return date from silently sitting before it.
                          if (date > form.returnDate) {
                            setField("returnDate", date);
                          }
                        }}
                        defaultMonth={form.departureDate}
                      />
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger>
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText>
                            Return Date{" "}
                            <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          className="cursor-pointer"
                          value={format(form.returnDate, "PPP")}
                        />
                      </InputGroup>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={form.returnDate}
                        onSelect={(date) => {
                          if (date) setField("returnDate", date);
                        }}
                        defaultMonth={form.returnDate}
                        disabled={{ before: form.departureDate }}
                      />
                    </PopoverContent>
                  </Popover>

                  {durationLabel && (
                    <p className="sm:col-span-2 -mt-2 text-[11px] text-muted-foreground">
                      {durationLabel}
                    </p>
                  )}

                  {durationMismatch !== null && selected && (
                    <div
                      className={cn(
                        "sm:col-span-2 flex items-start gap-2 rounded-sm px-2.5 py-2 text-xs",
                        TONE_CLASS.warning,
                      )}
                    >
                      <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                      <span>
                        These dates span {durationMismatch} day
                        {durationMismatch === 1 ? "" : "s"}, but {selected.name}{" "}
                        is a {selected.durationDays}-day template. The
                        accommodation blocks copied from it are laid out for{" "}
                        {selected.durationDays} days — check and adjust them on
                        the group after it&apos;s created.
                      </span>
                    </div>
                  )}

                  <Field
                    label="Capacity"
                    required
                    error={fieldError("capacity")}
                  >
                    <InputGroupInput
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.capacity}
                      onChange={(e) => setField("capacity", e.target.value)}
                      className="font-number"
                    />
                  </Field>

                  <Field
                    label="Minimum Group Size"
                    error={fieldError("minimumGroupSize")}
                  >
                    <InputGroupInput
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.minimumGroupSize}
                      onChange={(e) =>
                        setField("minimumGroupSize", e.target.value)
                      }
                      className="font-number"
                    />
                  </Field>

                  <Field
                    label="Sales Status"
                    required
                    error={fieldError("salesStatus")}
                  >
                    <SelectMenu
                      value={form.salesStatus}
                      options={SALES_STATUSES.map((status) => ({
                        value: status,
                        label: SALES_STATUS_LABELS[status],
                      }))}
                      onChange={(value) =>
                        setField("salesStatus", value as GroupSalesStatus)
                      }
                    />
                  </Field>

                  <Field label="Seat Hold Expiry">
                    <SelectMenu
                      value={String(form.seatHoldExpiryHours)}
                      options={SEAT_HOLD_CHOICES.map((hours) => ({
                        value: String(hours),
                        label: `${hours} hours`,
                      }))}
                      onChange={(value) =>
                        setField("seatHoldExpiryHours", Number(value))
                      }
                    />
                  </Field>

                  <Field label="Primary Operations Owner">
                    <InputGroupInput
                      value={form.operationsOwnerName}
                      onChange={(e) =>
                        setField("operationsOwnerName", e.target.value)
                      }
                      placeholder="M. Rameez"
                    />
                  </Field>

                  <Field
                    label="Primary Guide"
                    hint="Optional — can be assigned later."
                  >
                    <InputGroupInput
                      value={form.primaryGuideName}
                      onChange={(e) =>
                        setField("primaryGuideName", e.target.value)
                      }
                      placeholder="Imran R."
                    />
                  </Field>

                  <Card className="sm:col-span-2 shadow-xs! px-4.5 py-3 flex flex-row items-center justify-between ">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Waitlist enabled
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Accept waitlist requests once the group is full.
                      </p>
                    </div>
                    <Switch
                      checked={form.waitlistEnabled}
                      onCheckedChange={(checked) =>
                        setField("waitlistEnabled", checked)
                      }
                    />
                  </Card>
                </div>

                {/* <Separator /> */}

                <div className="mt-4">
                  <p className="text-lg font-medium text-foreground">
                    Copy from {selected?.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Copied values become this group&apos;s own. Later edits to
                    the template will not change them.
                  </p>
                  <div className="grid gap-2 mt-3">
                    {COPY_LABELS.map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer"
                      >
                        <Checkbox
                          checked={copyOptions[key]}
                          onCheckedChange={(checked) =>
                            setCopyOptions((prev) => ({
                              ...prev,
                              [key]: checked === true,
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-5">
                <>
                  <div>
                    <p className="text-lg font-medium text-foreground">
                      This departure&apos;s price, cost & flights
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      None of this comes from the template — a template is
                      reusable precisely because it carries no price of its own.
                      Everything here is editable again later from the group.
                    </p>
                  </div>

                  <Card className="p-4 gap-3  shadow-sm dark:shadow-xl ">
                    <p className="text-sm font-medium text-foreground">
                      Room occupancy pricing{" "}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <Field label="Currency">
                        <SelectMenu
                          value={pricing.currency}
                          options={["LKR", "USD", "SAR", "EUR", "GBP"].map(
                            (c) => ({
                              value: c,
                              label: c,
                            }),
                          )}
                          onChange={(v) =>
                            setPricing((prev) => ({ ...prev, currency: v }))
                          }
                        />
                      </Field>
                      {(
                        [
                          ["quadPrice", "Quad"],
                          ["triplePrice", "Triple"],
                          ["doublePrice", "Double"],
                          ["singlePrice", "Single"],
                          ["childPrice", "Child"],
                          ["infantPrice", "Infant"],
                          ["earlyBirdPrice", "Early Bird"],
                          ["advanceDeposit", "Advance Deposit"],
                        ] as [keyof PricingState, string][]
                      ).map(([key, label]) => (
                        <Field
                          key={key}
                          label={label}
                          required={key === "quadPrice"}
                          error={
                            key === "quadPrice" && quadPriceMissing
                              ? "Required — this is the group's list price."
                              : key === "advanceDeposit" && depositExceedsPrice
                                ? "Cannot exceed the Quad price."
                                : undefined
                          }
                        >
                          <ButtonGroup>
                            <InputGroupInput
                              value={pricing.currency}
                              className="font-number flex-1"
                              readOnly
                            />
                            <CurrencyInput
                              value={pricing[key] as number | ""}
                              onValueChange={(val) =>
                                setPricing((prev) => ({
                                  ...prev,
                                  [key]: val,
                                }))
                              }
                              className="font-number flex-6"
                            />
                          </ButtonGroup>
                        </Field>
                      ))}
                    </div>
                    {pricing.quadPrice && (
                      <p className="text-[11px] text-muted-foreground">
                        Quad:{" "}
                        {formatExactCurrency(
                          Number(pricing.quadPrice),
                          pricing.currency,
                        )}
                      </p>
                    )}
                  </Card>

                  <Card className="p-4 gap-3 shadow-sm dark:shadow-xl ">
                    <p className="text-sm font-medium text-foreground">
                      Internal cost estimate (per pilgrim)
                    </p>
                    <p className="text-[11px] text-muted-foreground -mt-2">
                      Used for this departure&apos;s margin and break-even
                      calculation on the Overview tab. Optional — leave blank if
                      not known yet.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(
                        [
                          ["flightCostPerPilgrim", "Flight"],
                          ["accommodationCostPerPilgrim", "Accommodation"],
                          ["transportCostPerPilgrim", "Transport"],
                          ["visaInsuranceCostPerPilgrim", "Visa / Insurance"],
                          ["cateringCostPerPilgrim", "Catering"],
                          ["guideOperationsCostPerPilgrim", "Guide / Ops"],
                          ["contingencyCostPerPilgrim", "Contingency"],
                        ] as [keyof CostEstimateState, string][]
                      ).map(([key, label]) => (
                        <Field key={key} label={label}>
                          <ButtonGroup>
                            <InputGroupInput
                              value={pricing.currency}
                              readOnly
                              className="font-number"
                            />
                            <CurrencyInput
                              value={costEstimate[key] as number | ""}
                              onValueChange={(val) =>
                                setCostEstimate((prev) => ({
                                  ...prev,
                                  [key]: val,
                                }))
                              }
                              className="font-number flex-6"
                            />
                          </ButtonGroup>
                        </Field>
                      ))}
                      <Field
                        label="Fixed cost / departure"
                        hint="A coach, a guide's fee — costs that don't shrink with headcount."
                      >
                        <ButtonGroup>
                          <InputGroupInput
                            value={pricing.currency}
                            readOnly
                            className="flex-1 font-number"
                          />
                          <CurrencyInput
                            value={parseInt(costEstimate.fixedCostPerDeparture)}
                            onValueChange={(val) => {
                              setCostEstimate((prev) => ({
                                ...prev,
                                fixedCostPerDeparture: String(val ?? ""),
                              }));
                            }}
                            className="font-number flex-6"
                          />
                        </ButtonGroup>
                      </Field>
                    </div>
                  </Card>

                  <Card
                    className={cn(
                      "p-4 gap-3 dark:bg-transparent",
                      TONE_STAT_CARD.warning,
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">
                      Margin check
                    </p>
                    <p className="text-[11px] text-muted-foreground -mt-2">
                      A preview of this departure&apos;s own margin, using the
                      Quad price as the list price — the same basis the Overview
                      tab uses once bookings exist.
                    </p>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <Card className="flex-1 gap-1 bg-card/10  px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">
                          Cost / pilgrim
                        </p>
                        <p className="text-sm font-semibold text-foreground font-number">
                          {formatExactCurrency(costPerPax, pricing.currency)}
                        </p>
                      </Card>
                      <Card className="flex-1 gap-1 bg-card/10  px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">
                          Margin / pilgrim
                        </p>
                        <p
                          className={cn(
                            "text-sm font-semibold font-number",
                            marginPerPax === null
                              ? "text-muted-foreground"
                              : marginPerPax >= 0
                                ? TONE_TEXT.success
                                : TONE_TEXT.danger,
                          )}
                        >
                          {marginPerPax === null
                            ? "—"
                            : `${formatExactCurrency(marginPerPax, pricing.currency)} (${marginPercent?.toFixed(1)}%)`}
                        </p>
                      </Card>
                      <Card className="flex-1 gap-1 bg-card/10  px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">
                          Break-even seats
                        </p>
                        <p className="text-sm font-semibold text-foreground font-number">
                          {breakEvenHeadcount === null
                            ? "—"
                            : `${breakEvenHeadcount} of ${capacityValue || "?"}`}
                        </p>
                      </Card>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "w-fit border-none text-xs font-normal",
                        marginBadge.color,
                      )}
                    >
                      {marginBadge.label}
                    </Badge>
                    {breakEvenHeadcount !== null &&
                      capacityValue > 0 &&
                      breakEvenHeadcount > capacityValue && (
                        <p className={cn("text-[11px]", TONE_TEXT.warning)}>
                          Break-even needs more seats than this group&apos;s
                          capacity ({capacityValue}) — this departure cannot
                          cover its fixed cost even if it sells out.
                        </p>
                      )}
                  </Card>

                  {copyOptions.flights ? (
                    <Card className="p-4 gap-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          Flight routing
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            Flights included
                          </span>
                          <Switch
                            checked={flightRouting.flightsIncluded}
                            onCheckedChange={(checked) =>
                              setFlightRouting((prev) => ({
                                ...prev,
                                flightsIncluded: checked,
                              }))
                            }
                          />
                        </div>
                      </div>
                      {flightRouting.flightsIncluded && (
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Origin">
                            <InputGroupInput
                              value={flightRouting.departureOrigin}
                              onChange={(e) =>
                                setFlightRouting((prev) => ({
                                  ...prev,
                                  departureOrigin: e.target.value,
                                }))
                              }
                              placeholder="Colombo (CMB)"
                            />
                          </Field>
                          <Field label="Arrival Gateway">
                            <InputGroupInput
                              value={flightRouting.arrivalGateway}
                              onChange={(e) =>
                                setFlightRouting((prev) => ({
                                  ...prev,
                                  arrivalGateway: e.target.value,
                                }))
                              }
                              placeholder="Jeddah"
                            />
                          </Field>
                          <Field label="Return Gateway">
                            <InputGroupInput
                              value={flightRouting.returnGateway}
                              onChange={(e) =>
                                setFlightRouting((prev) => ({
                                  ...prev,
                                  returnGateway: e.target.value,
                                }))
                              }
                              placeholder="Jeddah"
                            />
                          </Field>
                          <Field label="Preferred Airline">
                            <InputGroupInput
                              value={flightRouting.preferredAirline}
                              onChange={(e) =>
                                setFlightRouting((prev) => ({
                                  ...prev,
                                  preferredAirline: e.target.value,
                                }))
                              }
                              placeholder="Sri Lankan Airlines"
                            />
                          </Field>
                          <Field label="Cabin Class" className="col-span-2">
                            <SelectMenu
                              value={flightRouting.cabinClass}
                              options={[
                                "Economy",
                                "Premium Economy",
                                "Business",
                              ].map((c) => ({ value: c, label: c }))}
                              onChange={(v) =>
                                setFlightRouting((prev) => ({
                                  ...prev,
                                  cabinClass: v,
                                }))
                              }
                            />
                          </Field>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Seeds two draft flights (outbound/return) to book
                        against on the Flights tab — never a confirmed schedule.
                      </p>
                    </Card>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Flight routing skipped — &quot;Flight routing&quot; was
                      unchecked on the previous step.
                    </p>
                  )}
                </>
              </div>
            )}

            {formError && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
          </div>
        </SidebarStepperDialogBody>
      </DialogContent>
    </Dialog>
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <InputGroup>
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
        <span className="text-[11px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function SelectMenu({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={"w-full"}>
        <InputGroupInput
          value={selected?.label ?? "Select..."}
          readOnly
          className="w-full cursor-pointer"
        />
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

export default CreateDepartureGroupDialog;
