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
  InputGroupTextarea,
} from "@/components/ui/input-group";
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
import type { PackageFieldErrors } from "../schemas";

interface StepSalesOfferPricingProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
}

export const StepSalesOfferPricing: React.FC<StepSalesOfferPricingProps> = ({
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

  const milestoneCount = formData.paymentMilestones.length;
  const milestoneListError = fieldErrors?.paymentMilestones?.[0];
  const cancellationError = fieldErrors?.cancellationPolicy?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP 1: payment schedule (milestone builder) */}
      <Card className="px-5 py-5" variant="md-shadow">
        <CardHeader>
          <CardTitle>Payment schedule</CardTitle>
          <CardDescription>
            The milestones a customer pays through, in order. Start from a
            preset or build your own.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
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
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {formData.paymentMilestones.map((m, idx) => (
            <Card variant="md-shadow" key={m.id} className="gap-4 p-4">
              <CardHeader>
                <CardTitle className="text-sm">
                  {m.label || `Milestone ${idx + 1}`}
                </CardTitle>
                <CardDescription className="text-xs">
                  Milestone {idx + 1} of {milestoneCount}
                </CardDescription>
                <CardAction className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move milestone ${idx + 1} up`}
                    onClick={() => moveMilestone(idx, "up")}
                    disabled={idx === 0}
                  >
                    <MoveUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0"
                    aria-label={`Move milestone ${idx + 1} down`}
                    onClick={() => moveMilestone(idx, "down")}
                    disabled={idx === milestoneCount - 1}
                  >
                    <MoveDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="min-h-0 px-0 hover:text-destructive"
                    aria-label={`Delete milestone ${idx + 1}`}
                    onClick={() => removeMilestone(idx)}
                    disabled={milestoneCount <= 1}
                  >
                    <Trash2 />
                  </Button>
                </CardAction>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Milestone Label */}
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>
                        Milestone Label{" "}
                        <span className="text-destructive">*</span>
                      </InputGroupText>
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

                  {/* Amount Type */}
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Amount Type</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={m.amountType}
                          className="cursor-pointer"
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
                          onClick={() =>
                            updateMilestone(idx, { amountType: t })
                          }
                          className="cursor-pointer"
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Amount Input */}
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Amount</InputGroupText>
                    </InputGroupAddon>
                    {m.amountType === "Remaining Balance" ? (
                      <InputGroupInput
                        readOnly
                        value="Auto Remaining"
                        className="bg-muted/40 text-xs text-muted-foreground"
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
                      <ButtonGroup className="mt-0 w-full items-center px-3 pt-0">
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

                  {/* Due Rule */}
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Due Rule</InputGroupText>
                          <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
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

                {/* Conditional timing details & refundable */}
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                        className="h-7 w-40 text-xs"
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
                        className="h-7 w-24 text-xs"
                      />
                    </div>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Refundable:
                    </span>
                    <Switch
                      aria-label={`Milestone ${idx + 1} is refundable`}
                      checked={m.refundable}
                      onCheckedChange={(chk) =>
                        updateMilestone(idx, { refundable: chk })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {milestoneListError ? (
            <p className="text-xs text-destructive">{milestoneListError}</p>
          ) : null}

          <Button
            type="button"
            variant="outline_without_border"
            onClick={addMilestone}
            className="w-full cursor-pointer gap-2"
          >
            <Plus className="size-4" /> Add Payment Milestone
          </Button>
        </CardContent>
      </Card>

      {/* GROUP 2: customer-facing terms */}
      <Card className="px-5 py-5" variant="md-shadow">
        <CardHeader>
          <CardTitle>Customer-facing terms</CardTitle>
          <CardDescription>
            Policies shown to customers alongside the payment schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Cancellation &amp; Refund Policy{" "}
                  <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                rows={3}
                value={formData.cancellationPolicy}
                // aria-invalid={cancellationError ? true : undefined}
                onChange={(e) =>
                  updateField("cancellationPolicy", e.target.value)
                }
                placeholder="Detail refund eligibility timeframes..."
              />
            </InputGroup>
            {cancellationError ? (
              <p className="text-xs text-destructive">{cancellationError}</p>
            ) : null}
          </div>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Late Payment Policy</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              rows={3}
              value={formData.latePaymentPolicy}
              onChange={(e) => updateField("latePaymentPolicy", e.target.value)}
              placeholder="Specify rules for overdue balances..."
            />
          </InputGroup>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Price Change Disclaimer</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              rows={3}
              value={formData.priceChangeDisclaimer}
              onChange={(e) =>
                updateField("priceChangeDisclaimer", e.target.value)
              }
              placeholder="State terms regarding flight or tax increases..."
            />
          </InputGroup>
        </CardContent>
      </Card>
    </div>
  );
};

export default StepSalesOfferPricing;
