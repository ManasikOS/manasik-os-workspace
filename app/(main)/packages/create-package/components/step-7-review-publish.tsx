"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Package,
  CreditCard,
  Compass,
  ShieldCheck,
  FileCheck2,
  Users,
  Edit2,
  ArrowRight,
  TrendingUp,
  Sparkles,
  Plus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PackageFormData } from "../types";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import InputFormHeader from "@/components/ui/input-form-header";
import { cn } from "@/lib/utils";
import {
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
  type Tone,
} from "@/lib/ui/tone";
import SectionHeading from "@/components/section-heading";

const WARNING_TONE: Record<"warning" | "check", Tone> = {
  warning: "warning",
  check: "success",
};

interface StepReviewPublishProps {
  formData: PackageFormData;
  onGoToStep: (stepIndex: number) => void;
  onSaveDraft: () => void | Promise<void>;
  /** Resolves true once the package is persisted as published. */
  onPublish: () => Promise<boolean>;
}

export const StepReviewPublish: React.FC<StepReviewPublishProps> = ({
  formData,
  onGoToStep,
  onSaveDraft,
  onPublish,
}) => {
  const router = useRouter();
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);

  // Warnings / Validations Checklist Generator
  const warnings: { type: "warning" | "check"; text: string }[] = [];

  if (formData.itinerary.length < formData.days) {
    warnings.push({
      type: "warning",
      text: `${formData.days - formData.itinerary.length} of ${formData.days} itinerary days are not configured yet.`,
    });
  } else {
    warnings.push({
      type: "check",
      text: `All ${formData.days} itinerary days are configured.`,
    });
  }

  warnings.push({
    type: "check",
    text: "Flight routing and room-occupancy pricing are set per Departure Group, not here.",
  });

  if (
    !formData.makkahExactHotelGuarantee ||
    !formData.madinahExactHotelGuarantee
  ) {
    warnings.push({
      type: "warning",
      text: "Exact hotels will be confirmed per Departure Group (standard quality promised).",
    });
  }

  if (formData.paymentMilestones.length <= 1) {
    warnings.push({
      type: "warning",
      text: "Only 1 payment milestone configured.",
    });
  } else {
    warnings.push({
      type: "check",
      text: `${formData.paymentMilestones.length} payment milestones configured in payment schedule.`,
    });
  }

  warnings.push({
    type: "check",
    text: `${formData.documentRequirements.length} required document verification templates configured.`,
  });

  warnings.push({
    type: "check",
    text: `${formData.transportRequirements.length} transport requirements configured.`,
  });

  warnings.push({
    type: "check",
    text: `${formData.groupReadinessChecklist.length} group readiness checklist items configured.`,
  });

  const handleFinalPublishClick = async () => {
    // Only celebrate once the server confirms the package was published.
    const published = await onPublish();
    if (published) {
      setSuccessDialogOpen(true);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Review Cards Grid */}
      <div className="grid px-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
        {/* 1. Commercial Identity Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Commercial Identity"
              act={
                <div className="justify-end items-end">
                  <button
                    type="button"
                    onClick={() => onGoToStep(1)}
                    className="text-xs  text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <Edit2 className="size-3" /> Edit
                  </button>
                </div>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Package Name:</span>
                <span className="font-medium text-foreground truncate">
                  {formData.title}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Code:</span>
                <span className="font-mono text-foreground">
                  {formData.internalCode}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Journey Type:</span>
                <Badge
                  variant="outline"
                  className="text-sm bg-primary/10 text-primary"
                >
                  {formData.journeyType}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category:</span>
                <span className="font-medium text-foreground">
                  {formData.package_category}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Length:</span>
                <span className="font-medium text-foreground">
                  {formData.duration}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* 2. Pricing Policy Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Pricing Policy"
              act={
                <button
                  type="button"
                  onClick={() => onGoToStep(2)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Edit2 className="size-3" /> Edit
                </button>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Payment Milestones:
                </span>
                <span className="font-medium text-foreground">
                  {formData.paymentMilestones.length} Milestones
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Cancellation Policy:
                </span>
                <span className="font-medium text-foreground truncate max-w-40">
                  {formData.cancellationPolicy || "Not set"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                Room-occupancy prices and the internal cost estimate are set per
                Departure Group, not on the template.
              </p>
            </div>
          </div>
        </Card>

        {/* 3. Journey Itinerary Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Journey Itinerary"
              act={
                <button
                  type="button"
                  onClick={() => onGoToStep(3)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Edit2 className="size-3" /> Edit
                </button>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Itinerary Days:</span>
                <span className="font-medium text-primary">
                  {formData.itinerary.length} of {formData.days} Configured
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Flight routing is set per Departure Group, not on the template.
              </p>
            </div>
          </div>
        </Card>

        {/* 4. Service Standards Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Service Standards"
              act={
                <button
                  type="button"
                  onClick={() => onGoToStep(4)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Edit2 className="size-3" /> Edit
                </button>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Makkah Hotel:</span>
                <span className=" text-foreground">
                  {formData.makkahAccommodationStandard} (
                  {formData.makkahNights}N)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Madinah Hotel:</span>
                <span className=" text-foreground">
                  {formData.madinahAccommodationStandard} (
                  {formData.madinahNights}N)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Included Services:
                </span>
                <span className="font-medium text-foreground">
                  {formData.includedServices.length} Promised Services
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transport Routes:</span>
                <span className=" text-foreground">
                  {formData.transportRequirements.length} Routes
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* 5. Traveller Requirements Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Traveller Requirements"
              act={
                <button
                  type="button"
                  onClick={() => onGoToStep(5)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Edit2 className="size-3" /> Edit
                </button>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Document Rules:</span>
                <span className="font-medium text-foreground">
                  {formData.documentRequirements.length} Documents
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Seat Reservation:</span>
                <span className="text-foreground truncate">
                  {formData.seatReservationRule}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Comm Templates:</span>
                <span className=" text-foreground">
                  {formData.selectedCommunicationTemplates.length} Selected
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* 6. Group Defaults Summary */}
        <Card className="p-5 gap-3 flex flex-col justify-between">
          <div className="space-y-5">
            <SectionHeading
              title="Group Creation Defaults"
              act={
                <button
                  type="button"
                  onClick={() => onGoToStep(6)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Edit2 className="size-3" /> Edit
                </button>
              }
            />

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Target Capacity:</span>
                <span className="font-medium text-foreground">
                  {formData.defaultGroupCapacity} Pilgrims
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Min Group Size:</span>
                <span className="fon text-foreground">
                  {formData.minGroupSize} Pilgrims
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Readiness Checklist:
                </span>
                <span className="font-medium text-primary">
                  {formData.groupReadinessChecklist.length} Items
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Warnings & Checks Section */}
      <div className="px-2 flex flex-col  gap-5">
        <SectionHeading title=" Readiness Checks" />

        <div className="space-y-3 pb-5">
          {warnings.map((w, i) => {
            const tone = WARNING_TONE[w.type];
            return (
              <Card
                key={i}
                className={cn(
                  "px-3 py-3  rounded-sm flex-row  flex items-center gap-2",
                  TONE_STAT_CARD[tone],
                  TONE_TEXT[tone],
                )}
              >
                {w.type === "warning" ? (
                  <AlertTriangle
                    className={cn("size-4 shrink-0", TONE_TEXT.warning)}
                  />
                ) : (
                  <CheckCircle2
                    className={cn("size-4 shrink-0", TONE_TEXT.success)}
                  />
                )}
                <span>{w.text}</span>
              </Card>
            );
          })}
        </div>
      </div>

      {/* POST-PUBLISH SUCCESS DIALOG */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="sm:max-w-md text-center space-y-4">
          <div
            className={cn(
              "size-12 rounded-full mx-auto flex items-center justify-center",
              TONE_CLASS.success,
            )}
          >
            <CheckCircle2 className="size-7" />
          </div>

          <DialogHeader>
            <DialogTitle className="text-xl text-center font-bold">
              Package Published Successfully!
            </DialogTitle>
            <DialogDescription className="text-center text-xs">
              &quot;{formData.title}&quot; is now active in your agency
              catalogue. Sales staff and Manasik Copilot can now present and
              quote this package.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                setSuccessDialogOpen(false);
                router.push("/packages");
              }}
              className="w-full gap-2 cursor-pointer"
            >
              <Plus className="size-4" /> Create Departure Group from Package
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSuccessDialogOpen(false);
                router.push("/packages");
              }}
              className="w-full cursor-pointer text-xs"
            >
              View Packages List
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StepReviewPublish;
