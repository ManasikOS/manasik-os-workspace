/**
 * Re-exported from the single source of truth at `lib/validations/packages.ts`.
 * Kept here so existing relative imports (`../schemas`) inside the wizard
 * keep working without a wider rename.
 */
export {
  step1Schema,
  milestoneSchema,
  step2Schema,
  itineraryItemSchema,
  step3Schema,
  transportRequirementSchema,
  step4Schema,
  documentRequirementSchema,
  step5Schema,
  readinessRequirementSchema,
  step6Schema,
  crossFieldRulesSchema,
  crossFieldIssues,
  isStepValid,
  isPackageComplete,
  missingSteps,
  completenessPercent,
  toPackageFieldErrors,
  stepFieldErrors,
  type PackageFieldErrors,
} from "@/lib/validations/packages";
