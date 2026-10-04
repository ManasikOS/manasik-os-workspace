"use client";

import React from "react";
import {
  CheckSquare,
  Users,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Info,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PackageFormData, GroupReadinessRequirement } from "../types";
import SectionHeading from "@/components/section-heading";

interface StepGroupDefaultsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
}

const ROLES = ["Operations", "Visa", "Finance", "Guide", "Admin"] as const;
const TIMINGS = [
  "Before Booking",
  "Before Visa Submission",
  "21 days before departure",
  "14 days before departure",
  "7 days before departure",
  "5 days before departure",
  "3 days before departure",
];

export const StepGroupDefaults: React.FC<StepGroupDefaultsProps> = ({
  formData,
  setFormData,
}) => {
  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /** Keeps a non-numeric entry from putting NaN into the form state. */
  const parseCount = (raw: string): number | "" => {
    if (!raw) return "";
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? "" : parsed;
  };

  const addReadinessReq = () => {
    const newReq: GroupReadinessRequirement = {
      id: `gr-${crypto.randomUUID()}`,
      label: `Requirement ${formData.groupReadinessChecklist.length + 1}`,
      required: true,
      responsibleRole: "Operations",
      dueTiming: "7 days before departure",
    };
    updateField("groupReadinessChecklist", [
      ...formData.groupReadinessChecklist,
      newReq,
    ]);
  };

  const removeReadinessReq = (index: number) => {
    updateField(
      "groupReadinessChecklist",
      formData.groupReadinessChecklist.filter((_, i) => i !== index),
    );
  };

  const updateReadinessReq = (
    index: number,
    updated: Partial<GroupReadinessRequirement>,
  ) => {
    const list = [...formData.groupReadinessChecklist];
    list[index] = { ...list[index], ...updated };
    updateField("groupReadinessChecklist", list);
  };

  const moveReadinessReq = (index: number, dir: "up" | "down") => {
    const targetIdx = dir === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= formData.groupReadinessChecklist.length)
      return;
    const list = [...formData.groupReadinessChecklist];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    updateField("groupReadinessChecklist", list);
  };

  return (
    <div className="space-y-6">
      {/* Header */}

      {/* SECTION A: Default Group Settings */}
      <div className="flex flex-col gap-4">
        <SectionHeading title="Default Group Settings" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText className="text-xs">Capacity *</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                value={formData.defaultGroupCapacity}
                onChange={(e) =>
                  updateField(
                    "defaultGroupCapacity",
                    parseCount(e.target.value),
                  )
                }
                className="text-xs font-semibold"
              />
            </InputGroup>
            <p className="text-xs mt-1.5 text-muted-foreground">
              Pilgrims per group
            </p>
          </div>

          <div className="">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText className="text-xs">
                  Min Group Size
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                value={formData.minGroupSize}
                onChange={(e) =>
                  updateField("minGroupSize", parseCount(e.target.value))
                }
                className="text-xs"
              />
            </InputGroup>
            <p className="text-xs mt-1.5 text-muted-foreground">
              Min required to operate
            </p>
          </div>

          <div className="">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText className="text-xs">
                  Default Status
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                readOnly
                value={formData.defaultGroupStatus}
                className="text-xs font-semibold text-primary bg-muted/40"
              />
            </InputGroup>
            <p className="text-xs mt-1.5 text-muted-foreground">
              Initial state upon creation
            </p>
          </div>

          <div className="">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText className="text-xs">Guide Ratio</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                value={formData.suggestedGuideRatio}
                onChange={(e) =>
                  updateField("suggestedGuideRatio", parseCount(e.target.value))
                }
                className="text-xs"
              />
            </InputGroup>
            <p className="text-xs mt-1.5 text-muted-foreground">
              1 Guide per {formData.suggestedGuideRatio} pilgrims
            </p>
          </div>
        </div>
      </div>

      {/* SECTION B: Departure Group Readiness Template */}
      <div className="flex flex-col gap-5">
        <div>
          <SectionHeading
            description="These requirements are copied to each Departure Group and become
              its live readiness checklist."
            title="Departure Group Readiness Checklist Template"
          />
        </div>

        <div className="flex flex-col gap-5 px-2">
          {formData.groupReadinessChecklist.map((gr, idx) => (
            <Card key={gr.id} className="p-5 gap-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-xs bg-primary/10 text-primary font-semibold"
                  >
                    Task {idx + 1}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    {gr.label}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveReadinessReq(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  >
                    <MoveUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveReadinessReq(idx, "down")}
                    disabled={
                      idx === formData.groupReadinessChecklist.length - 1
                    }
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                  >
                    <MoveDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeReadinessReq(idx)}
                    disabled={formData.groupReadinessChecklist.length <= 1}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 cursor-pointer ml-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-3">
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText> Requirement Label *</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={gr.label}
                      onChange={(e) =>
                        updateReadinessReq(idx, { label: e.target.value })
                      }
                      className=" font-medium"
                    />
                  </InputGroup>
                </div>

                <div className="flex-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText> Responsible Role</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={gr.responsibleRole}
                          className="text-xs cursor-pointer"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {ROLES.map((r) => (
                        <DropdownMenuItem
                          key={r}
                          onClick={() =>
                            updateReadinessReq(idx, { responsibleRole: r })
                          }
                        >
                          {r}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText> Due Timing</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={gr.dueTiming}
                          className="text-xs cursor-pointer"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {TIMINGS.map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onClick={() =>
                            updateReadinessReq(idx, { dueTiming: t })
                          }
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2  text-xs text-muted-foreground">
                <span>Mandatory for Group Readiness:</span>
                <Switch
                  checked={gr.required}
                  onCheckedChange={(chk) =>
                    updateReadinessReq(idx, { required: chk })
                  }
                />
              </div>
            </Card>
          ))}
          <Button
            type="button"
            variant="outline_without_border"
            onClick={addReadinessReq}
            className="gap-1.5 mt-3 cursor-pointer"
          >
            <Plus className="size-3.5" /> Add Readiness Requirement
          </Button>
        </div>
      </div>
    </div>
  );
};

export default StepGroupDefaults;
