"use client";

import dynamic from "next/dynamic";
import type { Dispatch, SetStateAction } from "react";

import type { SidebarStepperStep } from "@/components/ui/sidebar-stepper-dialog-body";
import { Skeleton } from "@/components/ui/skeleton";

import type { PackageFieldErrors } from "../../create-package/schemas";
import type { PackageFormData } from "../../create-package/types";

// ---------------------------------------------------------------------------
// The seven steps of the package editor: their labels, and their content.
// Each step's form is only fetched when the step is opened, so the first
// chunk the editor needs does not carry all seven forms.
// ---------------------------------------------------------------------------

export const PACKAGE_EDITOR_STEPS: SidebarStepperStep[] = [
  {
    id: "commercial",
    label: "Commercial Identity",
    description:
      "Define what the agency is selling and how this package appears to sales staff, customers, and Manasik Copilot.",
  },
  {
    id: "pricing",
    label: "Sales Pricing Policy",
    description: "Set the reusable payment schedule and customer-facing terms.",
  },
  {
    id: "journey",
    label: "Journey Template",
    description:
      "Define the standard pilgrimage journey shown to pilgrims. Exact operational dates and flight bookings are confirmed later in Departure Groups.",
  },
  {
    id: "service",
    label: "Service Standards",
    description:
      "Define what the package promises and what each Departure Group must later arrange and confirm.",
  },
  {
    id: "traveller",
    label: "Traveller Requirements",
    description:
      "Choose the requirements automatically applied when a customer books a Departure Group.",
  },
  {
    id: "groups",
    label: "Group Creation Defaults",
    description:
      "Define what is copied into every real Departure Group created from this package.",
  },
  {
    id: "review",
    label: "Review & Publish",
    description:
      "Confirm that this package template is ready for sales staff, AI Sales Agent inquiries, and group creation.",
  },
];

const stepLoaders = [
  () => import("../../create-package/components/step-1-commercial-identity"),
  () => import("../../create-package/components/step-2-sales-offer-pricing"),
  () => import("../../create-package/components/step-3-journey-template"),
  () => import("../../create-package/components/step-4-service-standards"),
  () => import("../../create-package/components/step-5-traveller-requirements"),
  () => import("../../create-package/components/step-6-group-defaults"),
  () => import("../../create-package/components/step-7-review-publish"),
] as const;

/** Starts downloading a step's code ahead of time. Safe to call for a step that does not exist. */
export function preloadPackageEditorStep(stepIndex: number) {
  stepLoaders[stepIndex]?.();
}

function PackageEditorStepSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-2">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

const StepCommercialIdentity = dynamic(stepLoaders[0], { loading: PackageEditorStepSkeleton });
const StepSalesOfferPricing = dynamic(stepLoaders[1], { loading: PackageEditorStepSkeleton });
const StepJourneyTemplate = dynamic(stepLoaders[2], { loading: PackageEditorStepSkeleton });
const StepServiceStandards = dynamic(stepLoaders[3], { loading: PackageEditorStepSkeleton });
const StepTravellerRequirements = dynamic(stepLoaders[4], { loading: PackageEditorStepSkeleton });
const StepGroupDefaults = dynamic(stepLoaders[5], { loading: PackageEditorStepSkeleton });
const StepReviewPublish = dynamic(stepLoaders[6], { loading: PackageEditorStepSkeleton });

interface PackageEditorStepPanelProps {
  /** 0-based, matching `PACKAGE_EDITOR_STEPS`. */
  activeStep: number;
  formData: PackageFormData;
  setFormData: Dispatch<SetStateAction<PackageFormData>>;
  /** Row id once the draft exists, so the package's own code is not reported as already used. */
  packageId: string | null;
  /** Messages for the open step's fields; `null` until the step has been visited and left. */
  fieldErrors: PackageFieldErrors | null;
  /** Jumps to a step from the review step. 1-based, as the review step reports it. */
  onGoToStep: (step: number) => void;
}

/** Renders only the open step. */
export function PackageEditorStepPanel({
  activeStep,
  formData,
  setFormData,
  packageId,
  fieldErrors,
  onGoToStep,
}: PackageEditorStepPanelProps) {
  const fieldProps = { fieldErrors, formData, setFormData };

  switch (PACKAGE_EDITOR_STEPS[activeStep]?.id) {
    case "commercial":
      return <StepCommercialIdentity {...fieldProps} currentPackageId={packageId} />;
    case "pricing":
      return <StepSalesOfferPricing {...fieldProps} />;
    case "journey":
      return <StepJourneyTemplate {...fieldProps} />;
    case "service":
      return <StepServiceStandards {...fieldProps} />;
    case "traveller":
      return <StepTravellerRequirements {...fieldProps} />;
    case "groups":
      return <StepGroupDefaults {...fieldProps} />;
    case "review":
      return <StepReviewPublish formData={formData} onGoToStep={onGoToStep} />;
    default:
      return null;
  }
}
