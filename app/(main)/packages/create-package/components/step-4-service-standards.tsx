"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Building2,
  Bus,
  CheckCircle2,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  XCircle,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PackageFormData,
  TransportRequirement,
  DEFAULT_TRANSPORT_REQUIREMENTS,
} from "../types";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import SectionHeading from "@/components/section-heading";

interface StepServiceStandardsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
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

export const StepServiceStandards: React.FC<StepServiceStandardsProps> = ({
  formData,
  setFormData,
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

  return (
    <div className="space-y-6">
      {/* SECTION A: Service Inclusion Checklist */}
      <div className="flex flex-wrap gap-3">
        {ALL_PRESET_SERVICES.map((srv) => {
          const isChecked = formData.includedServices.includes(srv);
          return (
            <Badge
              key={srv}
              onClick={() => togglePresetService(srv)}
              className={`px-4 py-4  border-none cursor-pointer transition flex items-center gap-2 text-sm ${
                isChecked
                  ? "bg-primary/10 border-primary/40 text-primary font-medium"
                  : "bg-card/40 hover:bg-card text-muted-foreground"
              }`}
            >
              {/* <Checkbox checked={isChecked} /> */}
              <span className="truncate">{srv}</span>
            </Badge>
          );
        })}
      </div>

      {/* SECTION B: Accommodation Standards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Makkah Accommodation Card */}
        <div className="flex flex-col gap-4">
          <SectionHeading title="Makkah Accommodation Standard" />

          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Standard Rating</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.makkahAccommodationStandard}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {HOTEL_STANDARDS.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() =>
                          updateField("makkahAccommodationStandard", s)
                        }
                      >
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText className="">Nights</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    value={formData.makkahNights}
                    onChange={(e) =>
                      updateField("makkahNights", parseInt(e.target.value) || 0)
                    }
                    className="text-xs"
                  />
                </InputGroup>
              </div>
            </div>

            <div className="">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Customer-facing Wording *</InputGroupText>
                </InputGroupAddon>
                <InputGroupTextarea
                  value={formData.makkahCustomerWording}
                  onChange={(e) =>
                    updateField("makkahCustomerWording", e.target.value)
                  }
                  placeholder="e.g. 4-star accommodation near Masjid al-Haram or similar"
                  className="text-xs"
                />
              </InputGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Target Distance</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.makkahTargetDistance}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {HARAM_DISTANCES.map((d) => (
                      <DropdownMenuItem
                        key={d}
                        onClick={() => updateField("makkahTargetDistance", d)}
                      >
                        {d}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Meal Plan</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.makkahMealPlan}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {MEAL_PLANS.map((m) => (
                      <DropdownMenuItem
                        key={m}
                        onClick={() => updateField("makkahMealPlan", m)}
                      >
                        {m}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Exact Hotel Guarantee Toggle */}
            <Card className="p-5 bg-card/5 transition-all duration-300 dark:bg-transparent">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Exact Hotel Guarantee
                </span>
                <Switch
                  checked={formData.makkahExactHotelGuarantee}
                  onCheckedChange={(chk) =>
                    updateField("makkahExactHotelGuarantee", chk)
                  }
                />
              </div>

              {formData.makkahExactHotelGuarantee && (
                <div className="space-y-3 pt-2">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Hotel Name
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={formData.makkahHotel}
                      onChange={(e) =>
                        updateField("makkahHotel", e.target.value)
                      }
                      className="text-xs font-medium"
                    />
                  </InputGroup>

                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Display Name
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={formData.makkahExactDisplayName}
                      onChange={(e) =>
                        updateField("makkahExactDisplayName", e.target.value)
                      }
                      className="text-xs"
                    />
                  </InputGroup>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* Madinah Accommodation Card */}
        <div className="flex flex-col gap-4">
          <SectionHeading title="Madinah Accommodation Standard" />

          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Standard Rating</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.madinahAccommodationStandard}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {HOTEL_STANDARDS.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() =>
                          updateField("madinahAccommodationStandard", s)
                        }
                      >
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText className="text-xs">Nights</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    value={formData.madinahNights}
                    onChange={(e) =>
                      updateField(
                        "madinahNights",
                        parseInt(e.target.value) || 0,
                      )
                    }
                    className="text-xs"
                  />
                </InputGroup>
              </div>
            </div>

            <div className="">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Customer-facing Wording *</InputGroupText>
                </InputGroupAddon>
                <InputGroupTextarea
                  value={formData.madinahCustomerWording}
                  onChange={(e) =>
                    updateField("madinahCustomerWording", e.target.value)
                  }
                  placeholder="e.g. 4-star accommodation near Prophet's Mosque or similar"
                  className="text-xs"
                />
              </InputGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Target Distance</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.madinahTargetDistance}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {HARAM_DISTANCES.map((d) => (
                      <DropdownMenuItem
                        key={d}
                        onClick={() => updateField("madinahTargetDistance", d)}
                      >
                        {d}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Meal Plan</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={formData.madinahMealPlan}
                        className="text-xs cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {MEAL_PLANS.map((m) => (
                      <DropdownMenuItem
                        key={m}
                        onClick={() => updateField("madinahMealPlan", m)}
                      >
                        {m}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Exact Hotel Guarantee Toggle */}
            <Card className="p-5 bg-card/10 dark:bg-transparent">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Exact Hotel Guarantee
                </span>
                <Switch
                  checked={formData.madinahExactHotelGuarantee}
                  onCheckedChange={(chk) =>
                    updateField("madinahExactHotelGuarantee", chk)
                  }
                />
              </div>

              {formData.madinahExactHotelGuarantee && (
                <div className="space-y-3 pt-2">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Hotel Name
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={formData.madinahHotel}
                      onChange={(e) =>
                        updateField("madinahHotel", e.target.value)
                      }
                      className=" font-medium"
                    />
                  </InputGroup>

                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Display Name
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={formData.madinahExactDisplayName}
                      onChange={(e) =>
                        updateField("madinahExactDisplayName", e.target.value)
                      }
                      className="text-xs"
                    />
                  </InputGroup>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* SECTION C: Transport Requirements */}
      <div className="flex flex-col gap-5 dark:bg-transparent">
        <SectionHeading
          title="Default Transport Requirements"
          act={
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={addTransportReq}
              className="gap-1.5  h-7  cursor-pointer"
            >
              <Plus className="size-3.5" /> Add Transport Route
            </Button>
          }
        />

        <div className="space-y-3 px-2">
          {formData.transportRequirements.map((tr, idx) => (
            <Card
              key={tr.id}
              className="p-5 bg-transparent gap-6 dark:bg-transparent"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-sm px-3 py-3 bg-primary/10 text-primary font-medium"
                  >
                    Route {idx + 1}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    {tr.routeLabel}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveTransportReq(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  >
                    <MoveUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTransportReq(idx, "down")}
                    disabled={idx === formData.transportRequirements.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  >
                    <MoveDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTransportReq(idx)}
                    disabled={formData.transportRequirements.length <= 1}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 cursor-pointer ml-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Route Label *
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
                </div>

                <div className="">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">Start</InputGroupText>
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
                </div>

                <div className="">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText className="text-xs">
                        Destination
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={tr.destination}
                      onChange={(e) =>
                        updateTransportReq(idx, { destination: e.target.value })
                      }
                      className="text-xs"
                    />
                  </InputGroup>
                </div>

                <div className="">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText>Transport</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={tr.vehicleStandard}
                          className="text-xs cursor-pointer"
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
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* SECTION D: Customer Inclusions & Exclusions */}
      <div className="px-2  flex flex-col gap-5">
        <SectionHeading title="Customer-facing Inclusions" />

        <div className="flex gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon align={"block-start"}>
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
                variant={"link"}
                onClick={addCustomInclusion}
                className="text-xs cursor-pointer"
              >
                <Plus />
                Add
              </Button>
            </ButtonGroup>
          </InputGroup>
        </div>

        <div className="flex flex-col gap-3 pb-5 px-2 overflow-y-auto">
          {formData.inclusions.map((inc, i) => (
            <Card
              key={i}
              className="px-2 py-3  flex-row   flex items-center justify-between  bg-card"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className={cn("size-3.5", TONE_TEXT.success)} />
                {inc}
              </span>
              <button
                type="button"
                onClick={() => removeInclusion(i)}
                className="text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Card>
          ))}
        </div>
      </div>

      {/* Customer Exclusions */}
      <div className="px-2  flex flex-col gap-5">
        <SectionHeading title="Customer-facing Exclusions" />

        <div className="flex gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon align={"block-start"}>
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
                variant={"link"}
                onClick={addCustomExclusion}
                className="text-xs cursor-pointer"
              >
                <Plus />
                Add
              </Button>
            </ButtonGroup>
          </InputGroup>
        </div>

        <div className="flex flex-col gap-3 pb-5 px-2 overflow-y-auto">
          {formData.exclusions.map((exc, i) => (
            <Card
              key={i}
              className="px-2 py-3  flex-row   flex items-center justify-between  bg-card"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <XCircle className={cn("size-3.5", TONE_TEXT.danger)} />
                {exc}
              </span>
              <button
                type="button"
                onClick={() => removeExclusion(i)}
                className="text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StepServiceStandards;
