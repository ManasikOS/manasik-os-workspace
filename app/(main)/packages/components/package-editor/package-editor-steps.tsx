"use client";

import dynamic from "next/dynamic";
import type { Dispatch, SetStateAction } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { PackageFieldErrors } from "../../create-package/schemas";
import type { PackageFormData } from "../../create-package/types";

// ---------------------------------------------------------------------------
// The seven steps of the package editor: their labels, and their content.
// Each section's form is its own chunk, so the first chunk the editor needs
// does not carry all seven forms.
// ---------------------------------------------------------------------------

export interface PackageEditorStep {
  id: string;
  label: string;
  description: string;
}

export const PACKAGE_EDITOR_STEPS: PackageEditorStep[] = [
  {
    id: "commercial",
    label: "Commercial Identity",
    description: "What you are selling, and how sales staff, customers and Manasik Copilot see it.",
  },
  {
    id: "pricing",
    label: "Sales Pricing Policy",
    description: "The reusable payment schedule and the terms customers see.",
  },
  {
    id: "journey",
    label: "Journey Template",
    description: "The standard pilgrim journey. Exact dates and flights are set later, in Departure Groups.",
  },
  {
    id: "service",
    label: "Service Standards",
    description: "What the package promises, and what each Departure Group must later confirm.",
  },
  {
    id: "traveller",
    label: "Traveller Requirements",
    description: "Requirements applied automatically when a customer books a Departure Group.",
  },
  {
    id: "groups",
    label: "Group Creation Defaults",
    description: "What is copied into every Departure Group created from this package.",
  },
  {
    id: "review",
    label: "Review & Publish",
    description: "Check the package is ready for sales staff, AI Sales Agent inquiries and group creation.",
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

/** Starts downloading a step's code ahead of time. Safe to call for a step that does not exist. */
export function preloadPackageEditorStep(stepIndex: number) {
  stepLoaders[stepIndex]?.();
}

const StepCommercialIdentity = dynamic(stepLoaders[0], { loading: PackageEditorStepSkeleton });
const StepSalesOfferPricing = dynamic(stepLoaders[1], { loading: PackageEditorStepSkeleton });
const StepJourneyTemplate = dynamic(stepLoaders[2], { loading: PackageEditorStepSkeleton });
const StepServiceStandards = dynamic(stepLoaders[3], { loading: PackageEditorStepSkeleton });
const StepTravellerRequirements = dynamic(stepLoaders[4], { loading: PackageEditorStepSkeleton });
const StepGroupDefaults = dynamic(stepLoaders[5], { loading: PackageEditorStepSkeleton });
const StepReviewPublish = dynamic(stepLoaders[6], { loading: PackageEditorStepSkeleton });

interface PackageEditorStepContentProps {
  /** 0-based, matching `PACKAGE_EDITOR_STEPS`. */
  stepIndex: number;
  formData: PackageFormData;
  setFormData: Dispatch<SetStateAction<PackageFormData>>;
  /** Row id once the draft exists, so the package's own code is not reported as already used. */
  packageId: string | null;
  /** Messages for this step's fields; `null` until the step has been visited and left. */
  fieldErrors: PackageFieldErrors | null;
  /** Jumps to a step from the review step. 1-based, as the review step reports it. */
  onGoToStep: (step: number) => void;
}

/** The form fields of one step. */
export function PackageEditorStepContent({
  stepIndex,
  formData,
  setFormData,
  packageId,
  fieldErrors,
  onGoToStep,
}: PackageEditorStepContentProps) {
  const fieldProps = { fieldErrors, formData, setFormData };

  switch (PACKAGE_EDITOR_STEPS[stepIndex]?.id) {
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
