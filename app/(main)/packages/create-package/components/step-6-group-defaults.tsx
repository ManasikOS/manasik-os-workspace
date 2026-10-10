"use client";

import React from "react";
import { Plus, Trash2, MoveUp, MoveDown, ChevronDown } from "lucide-react";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PackageFormData, GroupReadinessRequirement } from "../types";
import type { PackageFieldErrors } from "../schemas";

interface StepGroupDefaultsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
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
  fieldErrors = null,
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

  const taskCount = formData.groupReadinessChecklist.length;
  const capacityError = fieldErrors?.defaultGroupCapacity?.[0];
  const checklistError = fieldErrors?.groupReadinessChecklist?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP 1: default group settings */}
      <Card className="px-5 py-5">
        <CardHeader>
          <CardTitle>Default group settings</CardTitle>
          <CardDescription>
            Starting values for every Departure Group created from this package.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Capacity <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  value={formData.defaultGroupCapacity}
                  aria-invalid={capacityError ? true : undefined}
                  onChange={(e) =>
                    updateField(
                      "defaultGroupCapacity",
                      parseCount(e.target.value),
                    )
                  }
                  className="text-xs font-semibold"
                />
              </InputGroup>
              {capacityError ? (
                <p className="text-xs text-destructive">{capacityError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pilgrims per group
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Min Group Size</InputGroupText>
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
              <p className="text-xs text-muted-foreground">
                Min required to operate
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Default Status</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={formData.defaultGroupStatus}
                  className="cursor-not-allowed bg-muted/40 text-xs font-semibold text-primary"
                />
              </InputGroup>
              <p className="text-xs text-muted-foreground">
                Initial state upon creation
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Guide Ratio</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  value={formData.suggestedGuideRatio}
                  onChange={(e) =>
                    updateField(
                      "suggestedGuideRatio",
                      parseCount(e.target.value),
                    )
                  }
                  className="text-xs"
                />
              </InputGroup>
              <p className="text-xs text-muted-foreground">
                1 Guide per {formData.suggestedGuideRatio} pilgrims
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GROUP 2: departure group readiness checklist template */}
      <Card className="px-5 py-5">
        <CardHeader>
          <CardTitle>Departure group readiness checklist</CardTitle>
          <CardDescription>
            These requirements are copied to each Departure Group and become its
            live readiness checklist.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              onClick={addReadinessReq}
            >
              <Plus /> Add Readiness Requirement
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {formData.groupReadinessChecklist.map((gr, idx) => (
            <Card variant="md-shadow" key={gr.id} className="gap-4 p-4">
              <CardHeader>
                <CardTitle className="text-sm">
                  {gr.label || `Task ${idx + 1}`}
                </CardTitle>
                <CardDescription className="text-xs">
                  Task {idx + 1} of {taskCount}
                </CardDescription>
                <CardAction className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move task ${idx + 1} up`}
                    onClick={() => moveReadinessReq(idx, "up")}
                    disabled={idx === 0}
                  >
                    <MoveUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move task ${idx + 1} down`}
                    onClick={() => moveReadinessReq(idx, "down")}
                    disabled={idx === taskCount - 1}
                  >
                    <MoveDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0 hover:text-destructive"
                    aria-label={`Delete task ${idx + 1}`}
                    onClick={() => removeReadinessReq(idx)}
                    disabled={taskCount <= 1}
                  >
                    <Trash2 />
                  </Button>
                </CardAction>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <InputGroup>
                      <InputGroupAddon align="block-start">
                        <InputGroupText>
                          Requirement Label{" "}
                          <span className="text-destructive">*</span>
                        </InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        value={gr.label}
                        onChange={(e) =>
                          updateReadinessReq(idx, { label: e.target.value })
                        }
                        className="font-medium"
                      />
                    </InputGroup>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Responsible Role</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={gr.responsibleRole}
                          className="cursor-pointer text-xs"
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

                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Due Timing</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={gr.dueTiming}
                          className="cursor-pointer text-xs"
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

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={gr.required}
                    onCheckedChange={(chk) =>
                      updateReadinessReq(idx, { required: chk })
                    }
                  />
                  Mandatory for Group Readiness
                </label>
              </CardContent>
            </Card>
          ))}

          {checklistError ? (
            <p className="text-xs text-destructive">{checklistError}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default StepGroupDefaults;
