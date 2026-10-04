"use client";

import React, { useState } from "react";
import {
  FileCheck2,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Lock,
  MessageSquare,
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
} from "@/components/ui/input-group";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PackageFormData, DocumentRequirement } from "../types";
import SectionHeading from "@/components/section-heading";

interface StepTravellerRequirementsProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
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
const ROLES = ["Admin", "Operations", "Visa", "Finance"] as const;

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
> = ({ formData, setFormData }) => {
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}

      {/* SECTION A: Document Requirement Template */}
      <div className="flex flex-col gap-5 px-2">
        {formData.documentRequirements.map((doc, idx) => (
          <Card key={doc.id} className="p-5 gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs px-3 py-3 bg-primary/10 text-primary font-semibold"
                >
                  Rule {idx + 1}
                </Badge>
                <span className="text-sm font-medium text-foreground">
                  {doc.name}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveDocReq(idx, "up")}
                  disabled={idx === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <MoveUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDocReq(idx, "down")}
                  disabled={idx === formData.documentRequirements.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <MoveDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeDocReq(idx)}
                  disabled={formData.documentRequirements.length <= 1}
                  className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 cursor-pointer ml-1"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-3">
              <div className="flex-4">
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText>Requirement Name *</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={doc.name}
                    onChange={(e) =>
                      updateDocReq(idx, { name: e.target.value })
                    }
                    className="text-xs font-medium"
                  />
                </InputGroup>
              </div>
            </div>

            <div className="flex gap-5 items-end justify-between pt-2  text-muted-foreground">
              <div className="flex-1">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Required By Stage</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={doc.requiredByStage}
                        className="text-xs cursor-pointer"
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
              </div>
              <div className="flex-1">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText>Category</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={doc.category}
                        className="text-xs cursor-pointer"
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
              <div className="flex items-center text-xs gap-5 ml-5">
                <div className="flex items-center gap-2">
                  <span>Required Mandatory:</span>
                  <Switch
                    checked={doc.required}
                    onCheckedChange={(chk) =>
                      updateDocReq(idx, { required: chk })
                    }
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span>Visible in Pilgrim Portal:</span>
                  <Switch
                    checked={doc.visibleInPortal}
                    onCheckedChange={(chk) =>
                      updateDocReq(idx, { visibleInPortal: chk })
                    }
                  />
                </div>
              </div>
            </div>
          </Card>
        ))}
        <Button
          type="button"
          variant="outline_without_border"
          size="sm"
          onClick={addDocReq}
          className="gap-1.5 w-full text-xs h-7 cursor-pointer mt-3"
        >
          <Plus className="size-3.5" /> Add Requirement
        </Button>
      </div>

      {/* SECTION B & C: Seat Reservation Rule & Communication Templates */}
      <div className="flex flex-col gap-5">
        <SectionHeading title="Seat Reservation Rule" />

        <div className="flex flex-col gap-3 px-2">
          {SEAT_RULES.map((rule) => (
            <Card
              key={rule}
              onClick={() => updateField("seatReservationRule", rule)}
              className={`p-3 dark:shadow-xl flex-row  rounded-sm cursor-pointer transition flex items-center gap-3 text-sm ${
                formData.seatReservationRule === rule
                  ? "bg-primary/10 border-primary/50 text-primary font-medium"
                  : "bg-card/40 hover:bg-card text-muted-foreground"
              }`}
            >
              <div
                className={`size-4 rounded-full  flex items-center justify-center ${
                  formData.seatReservationRule === rule
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground"
                }`}
              >
                {formData.seatReservationRule === rule && (
                  <div className="size-1.5 bg-white rounded-full" />
                )}
              </div>
              <span>{rule}</span>
            </Card>
          ))}
        </div>
      </div>

      {/* SECTION C: Communication Templates */}
      <div className="flex flex-col gap-5 pb-10">
        <SectionHeading title="Automated Communication Templates" />

        <div className="flex flex-col gap-3 px-2">
          {COMM_TEMPLATES.map((tpl) => {
            const isChecked =
              formData.selectedCommunicationTemplates.includes(tpl);
            return (
              <Card
                key={tpl}
                onClick={() => toggleCommTemplate(tpl)}
                className={`p-3  dark:shadow-xl flex-row  rounded-sm cursor-pointer transition flex items-center gap-3 text-sm ${
                  isChecked
                    ? "bg-primary/10  text-primary font-medium"
                    : "bg-card/40 hover:bg-card text-muted-foreground"
                }`}
              >
                <Checkbox checked={isChecked} />
                <span>{tpl}</span>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StepTravellerRequirements;
