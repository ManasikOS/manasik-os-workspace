"use client";

import React from "react";
import {
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  ShieldCheck,
  HelpCircle,
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
  InputGroupTextarea,
} from "@/components/ui/input-group";
import InputFormHeader from "@/components/ui/input-form-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PackageFormData,
  PaymentMilestone,
  DEFAULT_PAYMENT_MILESTONES,
} from "../types";
import { ButtonGroup } from "@/components/ui/button-group";

interface StepSalesOfferPricingProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
}

export const StepSalesOfferPricing: React.FC<StepSalesOfferPricingProps> = ({
  formData,
  setFormData,
}) => {
  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Milestone Builder Actions
  const addMilestone = () => {
    const newM: PaymentMilestone = {
      id: `pm-${Date.now()}`,
      label: `Milestone ${formData.paymentMilestones.length + 1}`,
      amountType: "Fixed Amount",
      amount: 50000,
      dueRule: "Days Before Departure",
      daysBeforeDeparture: 30,
      refundable: false,
      notes: "",
    };
    updateField("paymentMilestones", [...formData.paymentMilestones, newM]);
  };

  const removeMilestone = (index: number) => {
    updateField(
      "paymentMilestones",
      formData.paymentMilestones.filter((_, i) => i !== index),
    );
  };

  const updateMilestone = (
    index: number,
    updated: Partial<PaymentMilestone>,
  ) => {
    const list = [...formData.paymentMilestones];
    list[index] = { ...list[index], ...updated };
    updateField("paymentMilestones", list);
  };

  const moveMilestone = (index: number, dir: "up" | "down") => {
    const targetIdx = dir === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= formData.paymentMilestones.length) return;
    const list = [...formData.paymentMilestones];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    updateField("paymentMilestones", list);
  };

  const applyPreset = (type: "Umrah" | "Hajj") => {
    updateField("paymentMilestones", DEFAULT_PAYMENT_MILESTONES[type]);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* SECTION B: Payment Schedule (Milestone Builder) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Presets:</span>
          <Button
            type="button"
            variant="outline_without_border"
            size="sm"
            onClick={() => applyPreset("Umrah")}
          >
            Umrah Preset
          </Button>
          <Button
            type="button"
            variant="outline_without_border"
            size="sm"
            onClick={() => applyPreset("Hajj")}
          >
            Hajj Preset
          </Button>
        </div>
      </div>

      {/* Milestone Rows */}
      <div className="space-y-3 px-2">
        {formData.paymentMilestones.map((m, idx) => (
          <Card key={m.id} className="p-4 bg-card/10 gap-6 relative group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs bg-primary/10 text-primary font-semibold"
                >
                  Step {idx + 1}
                </Badge>
                <span className="text-xs font-medium text-foreground">
                  {m.label}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveMilestone(idx, "up")}
                  disabled={idx === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <MoveUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveMilestone(idx, "down")}
                  disabled={idx === formData.paymentMilestones.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <MoveDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeMilestone(idx)}
                  disabled={formData.paymentMilestones.length <= 1}
                  className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 cursor-pointer ml-1"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Milestone Label */}
              <div className="">
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText> Milestone Label *</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="text"
                    value={m.label}
                    onChange={(e) =>
                      updateMilestone(idx, { label: e.target.value })
                    }
                    className="text-xs font-medium"
                  />
                </InputGroup>
              </div>

              {/* Amount Type */}
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Amount Type</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={m.amountType}
                        className=""
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(
                      [
                        "Fixed Amount",
                        "Percentage",
                        "Remaining Balance",
                      ] as const
                    ).map((t) => (
                      <DropdownMenuItem
                        key={t}
                        onClick={() => updateMilestone(idx, { amountType: t })}
                        className="cursor-pointer"
                      >
                        {t}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Amount Input */}
              <div className="">
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText>Amount</InputGroupText>
                  </InputGroupAddon>
                  {m.amountType === "Remaining Balance" ? (
                    <InputGroupInput
                      readOnly
                      value="Auto Remaining"
                      className="text-xs text-muted-foreground bg-muted/40"
                    />
                  ) : m.amountType === "Percentage" ? (
                    <InputGroupInput
                      type="number"
                      placeholder="e.g. 50"
                      value={m.amount}
                      onChange={(e) =>
                        updateMilestone(idx, {
                          amount: e.target.value
                            ? parseFloat(e.target.value)
                            : "",
                        })
                      }
                      className="text-xs"
                    />
                  ) : (
                    <ButtonGroup className="w-full px-3 mt-0 pt-0 items-center">
                      <CurrencyInput
                        placeholder="0"
                        prefix="LKR"
                        value={m.amount}
                        onValueChange={(val) =>
                          updateMilestone(idx, { amount: val })
                        }
                        className="text-xs"
                      />
                    </ButtonGroup>
                  )}
                </InputGroup>
              </div>

              {/* Due Rule */}
              <div className="">
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full text-start cursor-pointer">
                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText> Due Rule</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        readOnly
                        value={m.dueRule}
                        className="cursor-pointer"
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(
                      [
                        "On Booking",
                        "Fixed Date",
                        "Days Before Departure",
                      ] as const
                    ).map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onClick={() => updateMilestone(idx, { dueRule: r })}
                        className="cursor-pointer"
                      >
                        {r}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Conditional Timing Details & Refundable */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {m.dueRule === "Fixed Date" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Fixed Due Date:
                  </span>
                  <InputGroupInput
                    type="date"
                    value={m.dueDate || ""}
                    onChange={(e) =>
                      updateMilestone(idx, { dueDate: e.target.value })
                    }
                    className="text-xs h-7 w-40"
                  />
                </div>
              )}

              {m.dueRule === "Days Before Departure" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Days Prior to Departure:
                  </span>
                  <InputGroupInput
                    type="number"
                    placeholder="e.g. 14"
                    value={m.daysBeforeDeparture || ""}
                    onChange={(e) =>
                      updateMilestone(idx, {
                        daysBeforeDeparture: e.target.value
                          ? parseInt(e.target.value)
                          : "",
                      })
                    }
                    className="text-xs h-7 w-24"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">
                  Refundable:
                </span>
                <Switch
                  checked={m.refundable}
                  onCheckedChange={(chk) =>
                    updateMilestone(idx, { refundable: chk })
                  }
                />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button
        type="button"
        variant="outline_without_border"
        onClick={addMilestone}
        className="w-full gap-2  cursor-pointer"
      >
        <Plus className="size-4" /> Add Payment Milestone
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText> Cancellation & Refund Policy</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            rows={3}
            value={formData.cancellationPolicy}
            onChange={(e) => updateField("cancellationPolicy", e.target.value)}
            placeholder="Detail refund eligibility timeframes..."
          />
        </InputGroup>

        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText> Late Payment Policy</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            rows={3}
            value={formData.latePaymentPolicy}
            onChange={(e) => updateField("latePaymentPolicy", e.target.value)}
            placeholder="Specify rules for overdue balances..."
          />
        </InputGroup>

        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText> Price Change Disclaimer</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            rows={3}
            value={formData.priceChangeDisclaimer}
            onChange={(e) =>
              updateField("priceChangeDisclaimer", e.target.value)
            }
            placeholder="State terms regarding flight or tax increases..."
            className=""
          />
        </InputGroup>
      </div>
    </div>
  );
};

export default StepSalesOfferPricing;
