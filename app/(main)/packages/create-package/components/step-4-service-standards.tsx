"use client";

import React from "react";
import {
  Bus,
  Check,
  CheckCircle2,
  ChevronDown,
  MoveDown,
  MoveUp,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PackageFormData, TransportRequirement } from "../types";
import type { PackageFieldErrors } from "../schemas";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

interface StepServiceStandardsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
}

const ALL_PRESET_SERVICES = [
  "Return air ticket",
  "Visa support / processing",
  "Travel / medical insurance",
  "Makkah accommodation",
  "Madinah accommodation",
  "Airport transfer",
  "Makkah ↔ Madinah intercity transport",
  "Local / ziyarah transport",
  "Meals / catering",
  "Guided ziyarah tours",
  "Religious guide / Mutawwif support",
  "Zamzam allocation",
  "Welcome kit / Ihram kit",
  "SIM / eSIM",
  "Laundry",
  "Other custom service",
];

const HOTEL_STANDARDS = ["Economy", "3-star", "4-star", "5-star", "Custom"];
const MEAL_PLANS = ["Room Only", "Breakfast", "Half Board", "Full Board"];
const HARAM_DISTANCES = ["Within 250m", "Within 500m", "Within 1km", "Other"];
const VEHICLE_STANDARDS = ["Bus", "Private Car", "Train", "Other"] as const;

/** The two cities share one layout; only the form keys and wording differ. */
const ACCOMMODATION_CITIES = [
  {
    id: "makkah",
    title: "Makkah accommodation",
    wordingPlaceholder:
      "e.g. 4-star accommodation near Masjid al-Haram or similar",
    standardKey: "makkahAccommodationStandard",
    nightsKey: "makkahNights",
    wordingKey: "makkahCustomerWording",
    distanceKey: "makkahTargetDistance",
    mealKey: "makkahMealPlan",
    guaranteeKey: "makkahExactHotelGuarantee",
    hotelKey: "makkahHotel",
    displayKey: "makkahExactDisplayName",
  },
  {
    id: "madinah",
    title: "Madinah accommodation",
    wordingPlaceholder:
      "e.g. 4-star accommodation near Prophet's Mosque or similar",
    standardKey: "madinahAccommodationStandard",
    nightsKey: "madinahNights",
    wordingKey: "madinahCustomerWording",
    distanceKey: "madinahTargetDistance",
    mealKey: "madinahMealPlan",
    guaranteeKey: "madinahExactHotelGuarantee",
    hotelKey: "madinahHotel",
    displayKey: "madinahExactDisplayName",
  },
] as const;

export const StepServiceStandards: React.FC<StepServiceStandardsProps> = ({
  formData,
  setFormData,
  fieldErrors = null,
}) => {
  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Preset Services Checklist Toggle
  const togglePresetService = (service: string) => {
    if (formData.includedServices.includes(service)) {
      updateField(
        "includedServices",
        formData.includedServices.filter((s) => s !== service),
      );
    } else {
      updateField("includedServices", [...formData.includedServices, service]);
    }
  };

  // Transport Requirement Handlers
  const addTransportReq = () => {
    const newTr: TransportRequirement = {
      id: `tr-${crypto.randomUUID()}`,
      routeLabel: `Route ${formData.transportRequirements.length + 1}`,
      startLocation: "Location A",
      destination: "Location B",
      required: true,
      vehicleStandard: "Bus",
      vehicleNotes: "Air-conditioned bus",
      state: "Included",
      internalNotes: "",
    };
    updateField("transportRequirements", [
      ...formData.transportRequirements,
      newTr,
    ]);
  };

  const removeTransportReq = (index: number) => {
    updateField(
      "transportRequirements",
      formData.transportRequirements.filter((_, i) => i !== index),
    );
  };

  const updateTransportReq = (
    index: number,
    updated: Partial<TransportRequirement>,
  ) => {
    const list = [...formData.transportRequirements];
    list[index] = { ...list[index], ...updated };
    updateField("transportRequirements", list);
  };

  const moveTransportReq = (index: number, dir: "up" | "down") => {
    const targetIdx = dir === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= formData.transportRequirements.length)
      return;
    const list = [...formData.transportRequirements];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    updateField("transportRequirements", list);
  };

  // Customer Inclusions & Exclusions List Handlers
  const addCustomInclusion = () => {
    if (!formData.customInclusionInput.trim()) return;
    updateField("inclusions", [
      ...formData.inclusions,
      formData.customInclusionInput.trim(),
    ]);
    updateField("customInclusionInput", "");
  };

  const removeInclusion = (index: number) => {
    if (formData.inclusions.length <= 1) return;
    updateField(
      "inclusions",
      formData.inclusions.filter((_, i) => i !== index),
    );
  };

  const addCustomExclusion = () => {
    if (!formData.customExclusionInput.trim()) return;
    updateField("exclusions", [
      ...formData.exclusions,
      formData.customExclusionInput.trim(),
    ]);
    updateField("customExclusionInput", "");
  };

  const removeExclusion = (index: number) => {
    if (formData.exclusions.length <= 1) return;
    updateField(
      "exclusions",
      formData.exclusions.filter((_, i) => i !== index),
    );
  };

  const transportCount = formData.transportRequirements.length;
  const servicesError = fieldErrors?.includedServices?.[0];
  const transportError = fieldErrors?.transportRequirements?.[0];
  const inclusionsError = fieldErrors?.inclusions?.[0];
  const exclusionsError = fieldErrors?.exclusions?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP 1: service inclusion checklist */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Included services</CardTitle>
          <CardDescription>
            Pick every service this package promises.{" "}
            {formData.includedServices.length} selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            role="group"
            aria-label="Included services"
            className="flex flex-wrap gap-2"
          >
            {ALL_PRESET_SERVICES.map((srv) => {
              const isChecked = formData.includedServices.includes(srv);
              return (
                <Button
                  key={srv}
                  type="button"
                  size="sm"
                  className="min-h-0"
                  variant={isChecked ? "secondary" : "outline_without_border"}
                  aria-pressed={isChecked}
                  onClick={() => togglePresetService(srv)}
                >
                  {isChecked ? <Check /> : null}
                  {srv}
                </Button>
              );
            })}
          </div>
          {servicesError ? (
            <p className="text-xs text-destructive">{servicesError}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* GROUP 2: accommodation standards, one collapsible section per city */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Accommodation standards</CardTitle>
          <CardDescription>
            What each Departure Group must arrange in Makkah and Madinah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion multiple defaultValue={["makkah"]}>
            {ACCOMMODATION_CITIES.map((city) => {
              const standard = formData[city.standardKey];
              const nights = formData[city.nightsKey];
              const cityError = fieldErrors?.[city.standardKey]?.[0];
              return (
                <AccordionItem key={city.id} value={city.id}>
                  <AccordionTrigger>
                    <span className="flex flex-col gap-0.5">
                      <span>{city.title}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {standard || "Rating not set"} · {nights} night
                        {nights === 1 ? "" : "s"}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-4 px-1 pt-2 pb-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                            <InputGroup>
                              <InputGroupAddon align="block-start">
                                <InputGroupText>
                                  Standard Rating{" "}
                                  <span className="text-destructive">*</span>
                                </InputGroupText>
                                <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                              </InputGroupAddon>
                              <InputGroupInput
                                readOnly
                                value={standard}
                                aria-invalid={cityError ? true : undefined}
                                className="cursor-pointer text-xs"
                              />
                            </InputGroup>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {HOTEL_STANDARDS.map((s) => (
                              <DropdownMenuItem
                                key={s}
                                onClick={() => updateField(city.standardKey, s)}
                              >
                                {s}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {cityError ? (
                          <p className="text-xs text-destructive">
                            {cityError}
                          </p>
                        ) : null}
                      </div>

                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Nights</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          type="number"
                          value={nights}
                          onChange={(e) =>
                            updateField(
                              city.nightsKey,
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="text-xs"
                        />
                      </InputGroup>
                    </div>

                    <InputGroup>
                      <InputGroupAddon align="block-start">
                        <InputGroupText>
                          Customer-facing Wording{" "}
                          <span className="text-destructive">*</span>
                        </InputGroupText>
                      </InputGroupAddon>
                      <InputGroupTextarea
                        value={formData[city.wordingKey]}
                        onChange={(e) =>
                          updateField(city.wordingKey, e.target.value)
                        }
                        placeholder={city.wordingPlaceholder}
                        className="text-xs"
                      />
                    </InputGroup>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                          <InputGroup>
                            <InputGroupAddon align="block-start">
                              <InputGroupText>Target Distance</InputGroupText>
                              <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                            </InputGroupAddon>
                            <InputGroupInput
                              readOnly
                              value={formData[city.distanceKey]}
                              className="cursor-pointer text-xs"
                            />
                          </InputGroup>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {HARAM_DISTANCES.map((d) => (
                            <DropdownMenuItem
                              key={d}
                              onClick={() => updateField(city.distanceKey, d)}
                            >
                              {d}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <DropdownMenu>
                        <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                          <InputGroup>
                            <InputGroupAddon align="block-start">
                              <InputGroupText>Meal Plan</InputGroupText>
                              <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                            </InputGroupAddon>
                            <InputGroupInput
                              readOnly
                              value={formData[city.mealKey]}
                              className="cursor-pointer text-xs"
                            />
                          </InputGroup>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {MEAL_PLANS.map((m) => (
                            <DropdownMenuItem
                              key={m}
                              onClick={() => updateField(city.mealKey, m)}
                            >
                              {m}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Exact hotel guarantee toggle */}
                    <Card variant="md-shadow" className="gap-1 px-4 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Exact Hotel Guarantee
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Promise a named hotel instead of &ldquo;or
                            similar&rdquo;.
                          </p>
                        </div>
                        <Switch
                          aria-label={`${city.title}: exact hotel guarantee`}
                          checked={formData[city.guaranteeKey]}
                          onCheckedChange={(chk) =>
                            updateField(city.guaranteeKey, chk)
                          }
                        />
                      </div>

                      {formData[city.guaranteeKey] && (
                        <div className="flex flex-col gap-3">
                          <InputGroup>
                            <InputGroupAddon align="block-start">
                              <InputGroupText>Hotel Name</InputGroupText>
                            </InputGroupAddon>
                            <InputGroupInput
                              value={formData[city.hotelKey]}
                              onChange={(e) =>
                                updateField(city.hotelKey, e.target.value)
                              }
                              className="text-xs font-medium"
                            />
                          </InputGroup>

                          <InputGroup>
                            <InputGroupAddon align="block-start">
                              <InputGroupText>Display Name</InputGroupText>
                            </InputGroupAddon>
                            <InputGroupInput
                              value={formData[city.displayKey]}
                              onChange={(e) =>
                                updateField(city.displayKey, e.target.value)
                              }
                              className="text-xs"
                            />
                          </InputGroup>
                        </div>
                      )}
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      {/* GROUP 3: transport requirements */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Default transport requirements</CardTitle>
          <CardDescription>
            Routes each Departure Group must cover.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              onClick={addTransportReq}
            >
              <Plus /> Add Transport Route
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {formData.transportRequirements.map((tr, idx) => (
            <Card variant="md-shadow" key={tr.id} className="gap-4 p-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bus className="size-3.5 text-muted-foreground" />
                  {tr.routeLabel || `Route ${idx + 1}`}
                </CardTitle>
                <CardDescription className="text-xs">
                  Route {idx + 1} of {transportCount}
                </CardDescription>
                <CardAction className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move route ${idx + 1} up`}
                    onClick={() => moveTransportReq(idx, "up")}
                    disabled={idx === 0}
                  >
                    <MoveUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move route ${idx + 1} down`}
                    onClick={() => moveTransportReq(idx, "down")}
                    disabled={idx === transportCount - 1}
                  >
                    <MoveDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0 hover:text-destructive"
                    aria-label={`Delete route ${idx + 1}`}
                    onClick={() => removeTransportReq(idx)}
                    disabled={transportCount <= 1}
                  >
                    <Trash2 />
                  </Button>
                </CardAction>
              </CardHeader>

              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>
                        Route Label <span className="text-destructive">*</span>
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={tr.routeLabel}
                      onChange={(e) =>
                        updateTransportReq(idx, { routeLabel: e.target.value })
                      }
                      className="text-xs font-medium"
                    />
                  </InputGroup>

                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Start</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={tr.startLocation}
                      onChange={(e) =>
                        updateTransportReq(idx, {
                          startLocation: e.target.value,
                        })
                      }
                      className="text-xs"
                    />
                  </InputGroup>

                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Destination</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={tr.destination}
                      onChange={(e) =>
                        updateTransportReq(idx, { destination: e.target.value })
                      }
                      className="text-xs"
                    />
                  </InputGroup>

                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Transport</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={tr.vehicleStandard}
                          className="cursor-pointer text-xs"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {VEHICLE_STANDARDS.map((v) => (
                        <DropdownMenuItem
                          key={v}
                          onClick={() =>
                            updateTransportReq(idx, { vehicleStandard: v })
                          }
                        >
                          {v}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          {transportError ? (
            <p className="text-xs text-destructive">{transportError}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* GROUP 4: customer-facing inclusions */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Customer-facing inclusions</CardTitle>
          <CardDescription>
            What customers are told is included in the price.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Add custom inclusion</InputGroupText>
            </InputGroupAddon>
            <ButtonGroup className="w-full items-center">
              <InputGroupInput
                placeholder="e.g Visa Processing, Meals, Entrance Fees etc."
                value={formData.customInclusionInput}
                onChange={(e) =>
                  updateField("customInclusionInput", e.target.value)
                }
                onKeyDown={(e) => e.key === "Enter" && addCustomInclusion()}
                className="text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="link"
                onClick={addCustomInclusion}
                className="cursor-pointer text-xs"
              >
                <Plus />
                Add
              </Button>
            </ButtonGroup>
          </InputGroup>

          {inclusionsError ? (
            <p className="text-xs text-destructive">{inclusionsError}</p>
          ) : null}

          {formData.inclusions.map((inc, i) => (
            <Card
              key={`${inc}-${i}`}
              size="sm"
              variant="md-shadow"
              className="flex-row items-center justify-between gap-3 px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className={cn("size-3.5", TONE_TEXT.success)} />
                {inc}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="min-h-0 px-0 hover:text-destructive"
                aria-label={`Remove inclusion: ${inc}`}
                onClick={() => removeInclusion(i)}
                disabled={formData.inclusions.length <= 1}
              >
                <Trash2 />
              </Button>
            </Card>
          ))}
        </CardContent>
      </Card>

      {/* GROUP 5: customer-facing exclusions */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Customer-facing exclusions</CardTitle>
          <CardDescription>
            What customers are told is not included in the price.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Add custom exclusion</InputGroupText>
            </InputGroupAddon>
            <ButtonGroup className="w-full items-center">
              <InputGroupInput
                placeholder="e.g Excess Baggage Charges"
                value={formData.customExclusionInput}
                onChange={(e) =>
                  updateField("customExclusionInput", e.target.value)
                }
                onKeyDown={(e) => e.key === "Enter" && addCustomExclusion()}
                className="text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="link"
                onClick={addCustomExclusion}
                className="cursor-pointer text-xs"
              >
                <Plus />
                Add
              </Button>
            </ButtonGroup>
          </InputGroup>

          {exclusionsError ? (
            <p className="text-xs text-destructive">{exclusionsError}</p>
          ) : null}

          {formData.exclusions.map((exc, i) => (
            <Card
              key={`${exc}-${i}`}
              size="sm"
              variant="md-shadow"
              className="flex-row items-center justify-between gap-3 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <XCircle className={cn("size-3.5", TONE_TEXT.danger)} />
                {exc}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="min-h-0 px-0 hover:text-destructive"
                aria-label={`Remove exclusion: ${exc}`}
                onClick={() => removeExclusion(i)}
                disabled={formData.exclusions.length <= 1}
              >
                <Trash2 />
              </Button>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default StepServiceStandards;
