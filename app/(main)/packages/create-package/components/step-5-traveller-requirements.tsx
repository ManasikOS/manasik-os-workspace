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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { PackageFormData, DocumentRequirement } from "../types";
import type { PackageFieldErrors } from "../schemas";

interface StepTravellerRequirementsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
}

const CATEGORIES = [
  "Passport",
  "Identity",
  "Visa",
  "Medical",
  "Finance",
  "Travel",
  "Other",
] as const;
const STAGES = [
  "On Booking",
  "Before Visa Submission",
  "Before Final Payment",
  "Before Departure",
] as const;

const SEAT_RULES = [
  "Deposit must be received before a group seat is reserved",
  "Staff may hold seat before payment",
  "Full payment required before visa process",
  "Custom rule",
];

const COMM_TEMPLATES = [
  "On Booking Confirmation",
  "Missing Document Reminder",
  "Payment Due Reminder",
  "7-Day Pre-Departure Briefing",
  "Guide & Emergency Contact Message",
];

export const StepTravellerRequirements: React.FC<
  StepTravellerRequirementsProps
> = ({ formData, setFormData, fieldErrors = null }) => {
  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Document Requirement Actions
  const addDocReq = () => {
    const newDoc: DocumentRequirement = {
      id: `doc-${crypto.randomUUID()}`,
      name: `Requirement ${formData.documentRequirements.length + 1}`,
      category: "Passport",
      required: true,
      requiredByStage: "Before Visa Submission",
      verifiedByRole: "Operations",
      visibleInPortal: true,
    };
    updateField("documentRequirements", [
      ...formData.documentRequirements,
      newDoc,
    ]);
  };

  const removeDocReq = (index: number) => {
    updateField(
      "documentRequirements",
      formData.documentRequirements.filter((_, i) => i !== index),
    );
  };

  const updateDocReq = (
    index: number,
    updated: Partial<DocumentRequirement>,
  ) => {
    const list = [...formData.documentRequirements];
    list[index] = { ...list[index], ...updated };
    updateField("documentRequirements", list);
  };

  const moveDocReq = (index: number, dir: "up" | "down") => {
    const targetIdx = dir === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= formData.documentRequirements.length)
      return;
    const list = [...formData.documentRequirements];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    updateField("documentRequirements", list);
  };

  const toggleCommTemplate = (tpl: string) => {
    if (formData.selectedCommunicationTemplates.includes(tpl)) {
      updateField(
        "selectedCommunicationTemplates",
        formData.selectedCommunicationTemplates.filter((t) => t !== tpl),
      );
    } else {
      updateField("selectedCommunicationTemplates", [
        ...formData.selectedCommunicationTemplates,
        tpl,
      ]);
    }
  };

  const docCount = formData.documentRequirements.length;
  const docListError = fieldErrors?.documentRequirements?.[0];
  const seatRuleError = fieldErrors?.seatReservationRule?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP 1: document requirements */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Document requirements</CardTitle>
          <CardDescription>
            Documents each traveller must provide, and by when.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              onClick={addDocReq}
            >
              <Plus /> Add Requirement
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {formData.documentRequirements.map((doc, idx) => (
            <Card variant="md-shadow" key={doc.id} className="gap-4 p-4">
              <CardHeader>
                <CardTitle className="text-sm">
                  {doc.name || `Requirement ${idx + 1}`}
                </CardTitle>
                <CardDescription className="text-xs">
                  Requirement {idx + 1} of {docCount}
                </CardDescription>
                <CardAction className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move requirement ${idx + 1} up`}
                    onClick={() => moveDocReq(idx, "up")}
                    disabled={idx === 0}
                  >
                    <MoveUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move requirement ${idx + 1} down`}
                    onClick={() => moveDocReq(idx, "down")}
                    disabled={idx === docCount - 1}
                  >
                    <MoveDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0 hover:text-destructive"
                    aria-label={`Delete requirement ${idx + 1}`}
                    onClick={() => removeDocReq(idx)}
                    disabled={docCount <= 1}
                  >
                    <Trash2 />
                  </Button>
                </CardAction>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>
                      Requirement Name{" "}
                      <span className="text-destructive">*</span>
                    </InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={doc.name}
                    onChange={(e) =>
                      updateDocReq(idx, { name: e.target.value })
                    }
                    className="text-xs font-medium"
                  />
                </InputGroup>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Required By Stage</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={doc.requiredByStage}
                          className="cursor-pointer text-xs"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {STAGES.map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() =>
                            updateDocReq(idx, { requiredByStage: s })
                          }
                        >
                          {s}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Category</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={doc.category}
                          className="cursor-pointer text-xs"
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {CATEGORIES.map((c) => (
                        <DropdownMenuItem
                          key={c}
                          onClick={() => updateDocReq(idx, { category: c })}
                        >
                          {c}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={doc.required}
                      onCheckedChange={(chk) =>
                        updateDocReq(idx, { required: chk })
                      }
                    />
                    Mandatory
                  </label>

                  <label className="flex items-center gap-2">
                    <Switch
                      checked={doc.visibleInPortal}
                      onCheckedChange={(chk) =>
                        updateDocReq(idx, { visibleInPortal: chk })
                      }
                    />
                    Visible in Pilgrim Portal
                  </label>
                </div>
              </CardContent>
            </Card>
          ))}

          {docListError ? (
            <p className="text-xs text-destructive">{docListError}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* GROUP 2: seat reservation rule */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>
            Seat reservation rule <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription>
            When a customer&apos;s seat on a Departure Group is secured.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <RadioGroup
            aria-label="Seat reservation rule"
            value={formData.seatReservationRule}
            onValueChange={(value) =>
              updateField("seatReservationRule", String(value))
            }
          >
            {SEAT_RULES.map((rule) => (
              <Card
                key={rule}
                size="sm"
                variant="md-shadow"
                className="rounded-sm bg-card/40 p-0 hover:bg-card has-data-checked:border-primary/50 has-data-checked:bg-primary/10"
              >
                <label className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-sm">
                  <RadioGroupItem value={rule} />
                  <span>{rule}</span>
                </label>
              </Card>
            ))}
          </RadioGroup>
          {seatRuleError ? (
            <p className="text-xs text-destructive">{seatRuleError}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* GROUP 3: communication templates */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Automated communication templates</CardTitle>
          <CardDescription>
            Messages sent automatically to travellers on this package.{" "}
            {formData.selectedCommunicationTemplates.length} selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {COMM_TEMPLATES.map((tpl) => {
            const isChecked =
              formData.selectedCommunicationTemplates.includes(tpl);
            return (
              <Card
                key={tpl}
                size="sm"
                variant="md-shadow"
                className={
                  isChecked
                    ? "rounded-sm bg-primary/10 p-0"
                    : "rounded-sm bg-card/40 p-0 hover:bg-card"
                }
              >
                <label className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-sm">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleCommTemplate(tpl)}
                  />
                  <span>{tpl}</span>
                </label>
              </Card>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default StepTravellerRequirements;
