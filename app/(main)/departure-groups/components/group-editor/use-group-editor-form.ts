"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { DepartureGroupFieldErrors } from "@/lib/validations/departure-groups";

import { generateGroupCodeAction } from "../../actions";
import type {
  GroupSalesStatus,
  PackageTemplateOption,
  TemplateCopyOptions,
} from "../../types";
import {
  applyTemplateDefaults,
  computeMarginPreview,
  DEFAULT_COPY,
  DEFAULT_COST_ESTIMATE,
  DEFAULT_FLIGHT_ROUTING,
  DEFAULT_PRICING,
  durationInDays,
  emptyDetails,
  toIsoDate,
  toNullableNumber,
  type CostEstimateState,
  type FlightRoutingState,
  type GroupDetailsState,
  type PricingState,
} from "./group-editor-model";

interface UseGroupEditorFormParams {
  templates: PackageTemplateOption[];
  role: StaffRole;
  branches: string[];
  /** A template to start from (the Packages screens deep-link here). Already checked against `templates`. */
  initialTemplateId: string | null;
}

/**
 * The form the person is filling in, and everything worked out from it:
 * which step is valid, the margin preview and the payload the server expects.
 * Nothing here saves anything; see `useGroupEditorSubmit`.
 */
export function useGroupEditorForm({
  templates,
  role,
  branches,
  initialTemplateId,
}: UseGroupEditorFormParams) {
  const branchChoices = branches.length > 0 ? branches : ["Colombo", "Kandy"];

  // The deep-linked template is picked from the first render, so the form
  // opens on step 2 data without an effect and without counting as an edit.
  const initialTemplate =
    templates.find((template) => template.id === initialTemplateId) ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(
    initialTemplate?.id ?? null,
  );
  // ADMIN-only: Draft packages are already excluded from `templates` for every
  // other role server-side, so this toggle has nothing to reveal for anyone
  // else. Off by default; only Open for Sale packages are offered.
  const [includeDrafts, setIncludeDrafts] = useState(
    initialTemplate ? !initialTemplate.isOpenForSale : false,
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [copyOptions, setCopyOptions] = useState<TemplateCopyOptions>(DEFAULT_COPY);
  const [details, setDetails] = useState<GroupDetailsState>(() => {
    const blank = emptyDetails(branchChoices[0]);
    return initialTemplate ? applyTemplateDefaults(blank, initialTemplate) : blank;
  });
  const [pricing, setPricing] = useState<PricingState>(DEFAULT_PRICING);
  const [costEstimate, setCostEstimate] =
    useState<CostEstimateState>(DEFAULT_COST_ESTIMATE);
  const [flightRouting, setFlightRouting] =
    useState<FlightRoutingState>(DEFAULT_FLIGHT_ROUTING);

  // Messages the server (or the schema, on submit) attached to fields.
  const [serverErrors, setServerErrors] = useState<DepartureGroupFieldErrors>({});

  const selected = templates.find((template) => template.id === selectedId) ?? null;

  const chooseTemplate = (template: PackageTemplateOption) => {
    setSelectedId(template.id);
    setDetails((previous) => applyTemplateDefaults(previous, template));
  };

  const setDetail = <K extends keyof GroupDetailsState>(
    key: K,
    value: GroupDetailsState[K],
  ) => {
    setDetails((previous) => ({ ...previous, [key]: value }));
    setServerErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  // Suggest a fresh group code whenever the template or departure date
  // changes: the field is read-only, so this is the only way it fills in.
  // Uniqueness is still re-checked against the store at submit time.
  const [isGeneratingCode, startCodeGeneration] = useTransition();
  const journeyType = selected?.journeyType;
  const departureIso = toIsoDate(details.departureDate);
  useEffect(() => {
    if (!journeyType) return;
    startCodeGeneration(async () => {
      const result = await generateGroupCodeAction({
        journeyType,
        departureDate: departureIso,
      });
      if (result.ok)
        setDetails((previous) => ({ ...previous, groupCode: result.code }));
    });
  }, [journeyType, departureIso]);

  // --- Derived ----------------------------------------------------------

  // Quad price is the group's list price everywhere downstream, so the last
  // step is gated on it here rather than in the schema (the schema also serves
  // CSV bulk-import, which legitimately has no price data to give yet).
  const quadPrice = toNullableNumber(pricing.quadPrice);
  const quadPriceMissing = quadPrice === null || quadPrice <= 0;
  const advanceDeposit = toNullableNumber(pricing.advanceDeposit);
  const depositExceedsPrice =
    advanceDeposit !== null && quadPrice !== null && advanceDeposit > quadPrice;

  const margin = useMemo(
    () => computeMarginPreview(quadPrice, costEstimate),
    [quadPrice, costEstimate],
  );
  const capacity = Number(details.capacity) || 0;

  const durationDays = useMemo(
    () => durationInDays(details.departureDate, details.returnDate),
    [details.departureDate, details.returnDate],
  );
  // The accommodation blocks seeded from the template are laid out from its own
  // length regardless of the group's real span, so flag a mismatch up front.
  const durationMismatch =
    selected && durationDays !== null && durationDays !== selected.durationDays
      ? durationDays
      : null;

  const templateAllowed = Boolean(selected) && (selected?.isOpenForSale || role === "ADMIN");
  // Index 0 = step 1. The review step has no fields of its own.
  const stepValidity = [
    templateAllowed,
    Boolean(details.groupName.trim()) && Boolean(details.capacity),
    !quadPriceMissing && !depositExceedsPrice,
  ];

  /** The first thing wrong with each step, in the words shown to the person. */
  const stepProblems: (string | undefined)[] = [
    !selected
      ? "Choose a package template to continue."
      : !templateAllowed
        ? "Only an administrator can start a group from a template that is not open for sale."
        : undefined,
    !details.groupName.trim()
      ? "Enter a group name."
      : !details.capacity
        ? "Enter the group's capacity."
        : undefined,
    quadPriceMissing
      ? "Enter a Quad occupancy price. A departure group cannot be created without its own price."
      : depositExceedsPrice
        ? "Advance deposit cannot exceed the Quad price."
        : undefined,
  ];

  // Everything that counts as an edit. The group code is generated, not typed.
  const snapshot = JSON.stringify({
    selectedId,
    copyOptions,
    details: { ...details, groupCode: "" },
    pricing,
    costEstimate,
    flightRouting,
  });
  const [initialSnapshot] = useState(snapshot);
  const isDirty = snapshot !== initialSnapshot;

  const buildPayload = () => {
    if (!selected) return null;
    return {
      packageTemplateId: selected.id,
      groupName: details.groupName,
      groupCode: details.groupCode,
      departureDate: toIsoDate(details.departureDate),
      returnDate: toIsoDate(details.returnDate),
      capacity: Number(details.capacity),
      minimumGroupSize: Number(details.minimumGroupSize || 0),
      salesStatus: details.salesStatus as GroupSalesStatus,
      branch: details.branch,
      operationsOwnerName: details.operationsOwnerName,
      primaryGuideName: details.primaryGuideName,
      waitlistEnabled: details.waitlistEnabled,
      seatHoldExpiryHours: details.seatHoldExpiryHours,
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
        flightCostPerPilgrim: toNullableNumber(costEstimate.flightCostPerPilgrim),
        accommodationCostPerPilgrim: toNullableNumber(
          costEstimate.accommodationCostPerPilgrim,
        ),
        transportCostPerPilgrim: toNullableNumber(costEstimate.transportCostPerPilgrim),
        visaInsuranceCostPerPilgrim: toNullableNumber(
          costEstimate.visaInsuranceCostPerPilgrim,
        ),
        cateringCostPerPilgrim: toNullableNumber(costEstimate.cateringCostPerPilgrim),
        guideOperationsCostPerPilgrim: toNullableNumber(
          costEstimate.guideOperationsCostPerPilgrim,
        ),
        contingencyCostPerPilgrim: toNullableNumber(
          costEstimate.contingencyCostPerPilgrim,
        ),
        fixedCostPerDeparture: Number(costEstimate.fixedCostPerDeparture) || 0,
      },
      flightRouting: { ...flightRouting },
    };
  };

  return {
    // state
    selectedId,
    selected,
    includeDrafts,
    setIncludeDrafts,
    templateSearch,
    setTemplateSearch,
    copyOptions,
    setCopyOptions,
    details,
    setDetail,
    pricing,
    setPricing,
    costEstimate,
    setCostEstimate,
    flightRouting,
    setFlightRouting,
    serverErrors,
    setServerErrors,
    branchChoices,
    isGeneratingCode,
    chooseTemplate,
    // derived
    quadPriceMissing,
    depositExceedsPrice,
    margin,
    capacity,
    durationDays,
    durationMismatch,
    stepValidity,
    stepProblems,
    isDirty,
    buildPayload,
  };
}

export type GroupEditorForm = ReturnType<typeof useGroupEditorForm>;
