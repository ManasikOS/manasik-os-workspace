import { z } from "zod";

import type { PackageFormData } from "@/app/(main)/packages/create-package/types";

/**
 * Single source of truth for package-wizard validation.
 *
 * Previously split across two independently-maintained files
 * (`create-package/schemas.ts` for step gating, `create-package/server-schema.ts`
 * for the Server Action's wire-shape check) with the same sub-objects
 * (itinerary item, payment milestone, ...) defined twice and free to drift.
 * Every sub-object shape is now defined exactly once here; the wire schema and
 * the per-step completeness schemas both build on it.
 *
 * `packageFormSchema` answers "is this a well-formed payload" (lenient — empty
 * numeric fields are legal, this only gates what a Server Action will accept
 * onto the wire). `stepNSchema` answers "is step N complete enough to publish"
 * (strict — the business rules). A draft can satisfy the former and fail the
 * latter; that is expected and is exactly what autosave vs. publish check for.
 */

/**
 * Numeric inputs are `""` while empty in the UI. A stray `NaN` from a bad
 * `parseInt` is normalised to `""` rather than rejected — one malformed field
 * should not fail validation for the entire payload and stall autosave.
 */
const numberOrEmpty = z.preprocess(
  (value) => (typeof value === "number" && !Number.isFinite(value) ? "" : value),
  z.union([z.number().finite(), z.literal("")]),
);
const text = z.string().default("");

/* ── Shared sub-object shapes ─────────────────────────────────────────────── */

export const itineraryItemSchema = z.object({
  id: z.string(),
  dayNumber: z.number(),
  title: text,
  location: text.optional(),
  description: text,
  category: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const paymentMilestoneSchema = z.object({
  id: z.string(),
  label: text,
  amountType: z.enum(["Fixed Amount", "Percentage", "Remaining Balance"]),
  amount: numberOrEmpty,
  dueRule: z.enum(["On Booking", "Fixed Date", "Days Before Departure"]),
  dueDate: z.string().optional(),
  daysBeforeDeparture: numberOrEmpty.optional(),
  refundable: z.boolean(),
  notes: z.string().optional(),
});

export const transportRequirementSchema = z.object({
  id: z.string(),
  routeLabel: text,
  startLocation: text,
  destination: text,
  required: z.boolean(),
  vehicleStandard: z.enum(["Bus", "Private Car", "Train", "Other"]),
  vehicleNotes: text,
  state: z.enum(["Included", "Optional"]),
  internalNotes: z.string().optional(),
});

export const documentRequirementSchema = z.object({
  id: z.string(),
  name: text,
  category: z.enum([
    "Passport",
    "Identity",
    "Visa",
    "Medical",
    "Finance",
    "Travel",
    "Other",
  ]),
  required: z.boolean(),
  requiredByStage: z.enum([
    "On Booking",
    "Before Visa Submission",
    "Before Final Payment",
    "Before Departure",
  ]),
  verifiedByRole: z.enum(["Admin", "Operations", "Visa", "Finance"]),
  visibleInPortal: z.boolean(),
});

export const readinessRequirementSchema = z.object({
  id: z.string(),
  label: text,
  required: z.boolean(),
  responsibleRole: z.enum(["Operations", "Visa", "Finance", "Guide", "Admin"]),
  dueTiming: text,
});

/* ── Wire-shape schema — the Server Action's real gate ───────────────────── */

export const packageFormSchema = z.object({
  // Step 1
  title: text,
  internalCode: text,
  description: text,
  journeyType: z.enum(["Umrah", "Hajj", "Early Registration"]),
  category: z.enum(["Hajj", "Umrah"]),
  year: z.union([z.number(), z.string()]),
  package_category: z.enum(["Economy", "Standard", "Premium", "VIP", "Custom"]),
  branch: text,
  visibility: z.enum(["Internal Only", "Pilgrim Portal", "Website & Portal"]),
  status: z.enum(["Draft", "Open for Sale", "Sales Closed", "Archived"]),
  featured: z.boolean(),
  defaultCapacity: numberOrEmpty,
  minGroupSize: numberOrEmpty,
  waitlistEnabled: z.boolean(),
  seatHoldExpiry: z.enum(["6 hours", "12 hours", "24 hours", "48 hours"]),
  suggestedGuideRatio: numberOrEmpty,
  maxPilgrims: numberOrEmpty,
  // A template's length is genuinely reusable — Package Classification now.
  days: z.number().int().min(0).max(365),
  nights: z.number().int().min(0).max(365),
  duration: text,

  // Step 2 — pricing POLICY only. Room-occupancy prices, the internal cost
  // estimate, and flight routing all moved to Departure Group creation (see
  // docs/architecture/package-departure-architecture-master-plan.md).
  paymentMilestones: z.array(paymentMilestoneSchema),
  paymentTerms: text,
  cancellationPolicy: text,
  latePaymentPolicy: text,
  priceChangeDisclaimer: text,
  financeRoleView: z.enum(["Admin", "CEO", "Finance", "Marketing"]),

  // Step 3 — itinerary only. Routing intent moved to Departure Group creation.
  itinerary: z.array(itineraryItemSchema),

  // Step 4
  includedServices: z.array(z.string()),
  makkahAccommodationStandard: text,
  makkahCustomerWording: text,
  makkahNights: z.number().int().min(0).max(365),
  makkahOccupancies: z.array(z.string()),
  makkahTargetDistance: text,
  makkahMealPlan: text,
  makkahExactHotelGuarantee: z.boolean(),
  makkahHotel: text,
  makkahExactDisplayName: text,
  madinahAccommodationStandard: text,
  madinahCustomerWording: text,
  madinahNights: z.number().int().min(0).max(365),
  madinahOccupancies: z.array(z.string()),
  madinahTargetDistance: text,
  madinahMealPlan: text,
  madinahExactHotelGuarantee: z.boolean(),
  madinahHotel: text,
  madinahExactDisplayName: text,
  transportType: text,
  transportRequirements: z.array(transportRequirementSchema),
  inclusions: z.array(z.string()),
  exclusions: z.array(z.string()),
  customInclusionInput: text,
  customExclusionInput: text,

  // Step 5
  documentRequirements: z.array(documentRequirementSchema),
  seatReservationRule: text,
  selectedCommunicationTemplates: z.array(z.string()),

  // Step 6
  defaultGroupCapacity: numberOrEmpty,
  defaultGroupStatus: text,
  groupReadinessChecklist: z.array(readinessRequirementSchema),

  // Legacy / metadata — accepted but not persisted.
  startDate: text,
  endDate: text,
  guide: text,
});

/**
 * A partial payload — used by patch autosave, which only sends changed keys.
 *
 * `status` and `featured` are omitted entirely, not merely made optional:
 * autosave must never be able to change a package's lifecycle state or its
 * featured flag — those go through `publishPackageAction`,
 * `setPackageFeaturedAction`, `archivePackageAction`, etc., which re-check
 * capability and (for publish) re-run every step's validation. Zod strips
 * unknown keys from an object schema by default, so even a payload that
 * still includes `status`/`featured` (a stale client) has them silently
 * dropped here rather than accepted. See
 * docs/modules/packages-production-readiness-plan.md, finding A1.
 */
export const packageFormPatchSchema = packageFormSchema
  .omit({ status: true, featured: true })
  .partial();

/**
 * Normalises the validated payload back into the exact `PackageFormData` shape
 * the mappers expect (dates as `Date`, optional arrays present).
 */
export function toPackageFormData(
  parsed: z.infer<typeof packageFormSchema>,
): PackageFormData {
  return { ...parsed } as PackageFormData;
}

/* ── Per-step completeness schemas — gate the wizard's "Next" and publish ── */

export const step1Schema = z.object({
  title: z.string().trim().min(1, "Package name is required"),
  internalCode: z.string().trim().min(1, "Internal code is required"),
  description: z.string().trim().min(1, "Package overview is required"),
  journeyType: z.enum(["Umrah", "Hajj", "Early Registration"]),
  package_category: z.string().trim().min(1, "Package category is required"),
  branch: z.string().optional(),
  visibility: z.enum(["Internal Only", "Pilgrim Portal", "Website & Portal"]),
  status: z.enum(["Draft", "Open for Sale", "Sales Closed", "Archived"]),
  featured: z.boolean(),
  defaultCapacity: z
    .union([z.number(), z.string()])
    .refine(
      (val) => val !== "" && !isNaN(Number(val)) && Number(val) > 0,
      "Planned capacity must be greater than 0",
    ),
  minGroupSize: z
    .union([z.number(), z.string()])
    .refine(
      (val) => val !== "" && !isNaN(Number(val)) && Number(val) > 0,
      "Minimum group size must be greater than 0",
    ),
  // A template's length is genuinely reusable — moved here from the old
  // Journey Template step alongside the rest of Package Classification.
  days: z.number().min(1, "Days must be at least 1"),
  nights: z.number().min(0, "Nights cannot be negative"),
});

export const milestoneSchema = paymentMilestoneSchema;

// Pricing POLICY only — the schedule structure and customer-facing terms.
// Room-occupancy prices are collected per Departure Group, not here (see
// docs/architecture/package-departure-architecture-master-plan.md): a template's price is
// not what every departure actually sells at.
export const step2Schema = z.object({
  paymentMilestones: z
    .array(milestoneSchema)
    .min(1, "At least one payment milestone is required"),
  cancellationPolicy: z.string().trim().min(1, "Cancellation policy is required"),
});

export const step3Schema = z.object({
  days: z.number().min(1, "Days must be at least 1"),
  nights: z.number().min(0, "Nights cannot be negative"),
  duration: z.string().trim().min(1, "Duration is required"),
  // An empty itinerary used to satisfy this schema (no `.min()`) while the
  // list screen's own gap calculator (`computeListStepGaps` below) already
  // required `itinerary_days > 0` — so a package could show "100% complete"
  // in one place and be missing step 3 in the other, depending only on
  // which of the two rule sets happened to check it (finding B5). Resolved
  // in favour of the stricter rule: a package should describe at least one
  // day of the journey to be publishable.
  itinerary: z.array(itineraryItemSchema).min(1, "At least one itinerary day is required"),
});

export const step4Schema = z.object({
  includedServices: z
    .array(z.string())
    .min(1, "At least one service inclusion is required"),
  makkahAccommodationStandard: z
    .string()
    .trim()
    .min(1, "Makkah accommodation standard is required"),
  madinahAccommodationStandard: z
    .string()
    .trim()
    .min(1, "Madinah accommodation standard is required"),
  transportRequirements: z
    .array(transportRequirementSchema)
    .min(1, "At least one transport requirement is required"),
  inclusions: z.array(z.string()).min(1, "At least one customer inclusion is required"),
  exclusions: z.array(z.string()).min(1, "At least one customer exclusion is required"),
});

export const step5Schema = z.object({
  documentRequirements: z
    .array(documentRequirementSchema)
    .min(1, "At least one document requirement is required"),
  seatReservationRule: z.string().trim().min(1, "Seat reservation rule is required"),
});

export const step6Schema = z.object({
  defaultGroupCapacity: z
    .union([z.number(), z.string()])
    .refine(
      (val) => val !== "" && !isNaN(Number(val)) && Number(val) > 0,
      "Group capacity must be greater than 0",
    ),
  groupReadinessChecklist: z
    .array(readinessRequirementSchema)
    .min(1, "At least one group readiness requirement is required"),
});

export const PACKAGE_STEP_SCHEMAS = [
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
] as const;

/**
 * Rules that compare fields belonging to two different steps, so they don't
 * fit any single `stepNSchema` above — none of B6's cross-field rules were
 * enforced anywhere before this (finding B6): a package with `minGroupSize`
 * greater than its own `defaultCapacity`, a negative payment milestone
 * amount, three different "Remaining Balance" milestones, or an itinerary
 * day numbered beyond the package's own `days` could all be published.
 *
 * Deliberately checked only at the final "is this package complete"
 * checkpoint (`isPackageComplete`/step 7/`publishPackageAction`), not
 * folded into `isStepValid(1..6)` — most of these fields live on different,
 * possibly not-yet-visited steps, so blocking an early step over a value in
 * a later one the user hasn't reached yet would be confusing rather than
 * helpful.
 */
export const crossFieldRulesSchema = z
  .object({
    days: z.number(),
    nights: z.number(),
    minGroupSize: z.union([z.number(), z.string()]),
    defaultCapacity: z.union([z.number(), z.string()]),
    maxPilgrims: z.union([z.number(), z.string()]),
    defaultGroupCapacity: z.union([z.number(), z.string()]),
    makkahNights: z.number(),
    madinahNights: z.number(),
    paymentMilestones: z.array(paymentMilestoneSchema),
    itinerary: z.array(itineraryItemSchema),
  })
  .superRefine((data, ctx) => {
    if (data.days !== data.nights + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["nights"],
        message: "Nights must be exactly one less than Days.",
      });
    }

    const minGroup = data.minGroupSize === "" ? null : Number(data.minGroupSize);
    const capacity = data.defaultCapacity === "" ? null : Number(data.defaultCapacity);
    const maxPilgrims = data.maxPilgrims === "" ? null : Number(data.maxPilgrims);
    const groupCapacity = data.defaultGroupCapacity === "" ? null : Number(data.defaultGroupCapacity);

    if (minGroup !== null && capacity !== null && minGroup > capacity) {
      ctx.addIssue({
        code: "custom",
        path: ["minGroupSize"],
        message: "Minimum group size cannot exceed the default capacity.",
      });
    }
    if (capacity !== null && maxPilgrims !== null && maxPilgrims > 0 && capacity > maxPilgrims) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultCapacity"],
        message: "Default capacity cannot exceed the maximum pilgrims.",
      });
    }
    if (groupCapacity !== null && maxPilgrims !== null && maxPilgrims > 0 && groupCapacity > maxPilgrims) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultGroupCapacity"],
        message: "Default group capacity cannot exceed the maximum pilgrims.",
      });
    }

    if (data.makkahNights + data.madinahNights > data.nights) {
      ctx.addIssue({
        code: "custom",
        path: ["makkahNights"],
        message: "Makkah + Madinah nights cannot exceed the package's total nights.",
      });
    }

    for (const milestone of data.paymentMilestones) {
      if (milestone.amount !== "" && Number(milestone.amount) < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["paymentMilestones"],
          message: `"${milestone.label || "Untitled milestone"}" has a negative amount.`,
        });
      }
    }
    const remainingBalanceCount = data.paymentMilestones.filter(
      (m) => m.amountType === "Remaining Balance",
    ).length;
    if (remainingBalanceCount > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMilestones"],
        message: 'Only one payment milestone can be "Remaining Balance".',
      });
    }
    const percentageTotal = data.paymentMilestones
      .filter((m) => m.amountType === "Percentage" && m.amount !== "")
      .reduce((sum, m) => sum + Number(m.amount), 0);
    if (percentageTotal > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMilestones"],
        message: "Payment milestone percentages add up to more than 100%.",
      });
    }

    for (const item of data.itinerary) {
      if (item.dayNumber < 1 || item.dayNumber > data.days) {
        ctx.addIssue({
          code: "custom",
          path: ["itinerary"],
          message: `Itinerary day ${item.dayNumber} is outside the package's ${data.days}-day length.`,
        });
      }
    }
  });

/** Cross-field rule violation messages, or `[]` when every rule passes. */
export function crossFieldIssues(data: PackageFormData): string[] {
  const result = crossFieldRulesSchema.safeParse(data);
  if (result.success) return [];
  // De-duplicated: several items can independently fail the same itinerary-
  // day-bounds or negative-amount rule, which would otherwise repeat the
  // same sentence once per offending item.
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}

export const isStepValid = (step: number, data: PackageFormData): boolean => {
  const schema = PACKAGE_STEP_SCHEMAS[step - 1];
  if (!schema) return step === 7 ? isPackageComplete(data) : true;
  return schema.safeParse(data).success;
};

export function isPackageComplete(data: PackageFormData): boolean {
  return (
    PACKAGE_STEP_SCHEMAS.every((schema) => schema.safeParse(data).success) &&
    crossFieldRulesSchema.safeParse(data).success
  );
}

/** Step numbers (1-6) whose schema currently fails against `data`. */
export function missingSteps(data: PackageFormData): number[] {
  return PACKAGE_STEP_SCHEMAS.reduce<number[]>((missing, schema, index) => {
    if (!schema.safeParse(data).success) missing.push(index + 1);
    return missing;
  }, []);
}

/** 0-100: how many of the six wizard steps are currently complete. */
export function completenessPercent(data: PackageFormData): number {
  const valid = PACKAGE_STEP_SCHEMAS.filter((schema) => schema.safeParse(data).success).length;
  return Math.round((valid / PACKAGE_STEP_SCHEMAS.length) * 100);
}

/**
 * Approximates `isStepValid`/`missingSteps` from the narrow list-row
 * projection (`PackageListRow`) rather than the full wizard form — the list
 * screen never selects the JSONB step bodies, only the array-length columns
 * the migration generates for them. Checks "is this array non-empty" instead
 * of validating every item's fields, which is what the list needs to surface
 * a "Primary gap" column without paying for the full row.
 */
export function computeListStepGaps(row: {
  title: string;
  internal_code: string;
  description?: string | null;
  package_category: string;
  default_capacity: number | null;
  min_group_size?: number | null;
  days?: number;
  cancellation_policy?: string | null;
  payment_milestones_count?: number;
  itinerary_days?: number;
  duration: string;
  transport_requirements_count?: number;
  inclusions_count?: number;
  exclusions_count?: number;
  included_services_count?: number;
  document_requirements_count?: number;
  group_readiness_checklist_count?: number;
  default_group_capacity?: number | null;
}): number[] {
  const missing: number[] = [];

  if (
    !row.title?.trim() ||
    !row.internal_code?.trim() ||
    // Optional on the type only because a few older callers (e.g. the CSV
    // export row shape) don't select `description` at all — when it truly
    // isn't in the projection this can't tell an empty description from an
    // unselected column, so it stays permissive (`!== undefined`) rather
    // than flagging every such row as incomplete. `packages-repository.ts`'s
    // `listPackages()` always selects it, so the list screen itself gets
    // the real check the step 1 schema (`step1Schema`) already requires —
    // this used to be the one step1 rule the list silently never checked
    // (finding B5).
    (row.description !== undefined && !row.description?.trim()) ||
    !row.package_category?.trim() ||
    !row.default_capacity ||
    row.default_capacity <= 0 ||
    !row.min_group_size ||
    row.min_group_size <= 0 ||
    !(row.days ?? 0)
  ) {
    missing.push(1);
  }

  // Pricing POLICY only — the actual prices live on the Departure Group now.
  if (
    !row.cancellation_policy?.trim() ||
    !(row.payment_milestones_count ?? 0)
  ) {
    missing.push(2);
  }

  if (!row.duration?.trim() || !(row.itinerary_days ?? 0)) missing.push(3);

  if (
    !(row.included_services_count ?? 0) ||
    !(row.transport_requirements_count ?? 0) ||
    !(row.inclusions_count ?? 0) ||
    !(row.exclusions_count ?? 0)
  ) {
    missing.push(4);
  }

  if (!(row.document_requirements_count ?? 0)) missing.push(5);

  if (
    !row.default_group_capacity ||
    row.default_group_capacity <= 0 ||
    !(row.group_readiness_checklist_count ?? 0)
  ) {
    missing.push(6);
  }

  return missing;
}

export function listCompletenessPercent(missing: number[]): number {
  return Math.round(((6 - missing.length) / 6) * 100);
}

export const STEP_LABELS = [
  "Commercial Identity",
  "Pricing",
  "Journey",
  "Services",
  "Requirements",
  "Group Defaults",
] as const;

/* ── Field errors, for inline display ────────────────────────────────────── */

export type PackageFieldErrors = Partial<Record<keyof PackageFormData, string[]>>;

export function toPackageFieldErrors(error: z.ZodError): PackageFieldErrors {
  return z.flattenError(error).fieldErrors as PackageFieldErrors;
}

/** Field errors for one step only, or `null` when that step is valid. */
export function stepFieldErrors(
  step: number,
  data: PackageFormData,
): PackageFieldErrors | null {
  const schema = PACKAGE_STEP_SCHEMAS[step - 1];
  if (!schema) return null;
  const result = schema.safeParse(data);
  if (result.success) return null;
  return toPackageFieldErrors(result.error);
}
