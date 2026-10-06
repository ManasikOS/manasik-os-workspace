import { z } from "zod";

/**
 * Departure Group schemas.
 *
 * Same posture as `lib/validations/auth.ts`: the browser runs them for instant
 * feedback and the Server Action runs them again as the real gate. Uniqueness
 * of `groupCode` is not expressible here — `actions.ts` checks it against the
 * repository after parsing.
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a valid date." });

const isoDateTime = z
  .string()
  .trim()
  .min(1, { error: "Use a valid date and time." });

const optionalText = z.string().trim().optional();

export const groupSalesStatusSchema = z.enum([
  "SELLING",
  "LIMITED_AVAILABILITY",
  "WAITLIST",
  "SALES_CLOSED",
  "CANCELLED",
]);

/**
 * A reference to a stored row. Every primary key in the schema is a uuid, so
 * anything else is a malformed or hand-made request and is refused here instead
 * of surfacing later as a database error. `guid` (any 8-4-4-4-12 hex) rather than
 * `uuid`, which also insists on an RFC version digit that seeded ids may lack.
 */
export const entityId = (message = "That reference is invalid.") =>
  z.string().trim().pipe(z.guid({ error: message }));

/** An optional reference where an empty string from a cleared picker means "none". */
export const optionalEntityId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  entityId().nullable().optional(),
);

/** A phone number as staff type it: digits with an optional leading +, spaces, brackets and dashes. */
export const phoneNumberSchema = z
  .string()
  .trim()
  .min(7, { error: "Enter a reachable phone number." })
  .max(25, { error: "That phone number is too long." })
  .regex(/^\+?[0-9 ()-]*[0-9][0-9 ()-]*$/, { error: "Use digits, spaces, brackets, dashes and an optional leading +." });

/** Passport numbers vary by country; this only keeps out anything that is not letters, digits, space or dash. */
export const passportNumberSchema = z
  .string()
  .trim()
  .max(20, { error: "A passport number is at most 20 characters." })
  .regex(/^[A-Za-z0-9 -]*$/, { error: "Use letters, digits, spaces and dashes only." });

/** Largest money amount any single field accepts, matching the payment and fare schemas. */
const MAX_MONEY = 1_000_000_000;

export const roomTypeSchema = z.enum([
  "QUAD",
  "TRIPLE",
  "DOUBLE",
  "SINGLE",
  "OTHER",
]);

export const readinessCategorySchema = z.enum([
  "FLIGHT",
  "HOTEL",
  "TRANSPORT",
  "PAYMENT",
  "DOCUMENT",
  "VISA",
  "ROOMING",
  "GUIDE",
  "MANIFEST",
  "CATERING",
  "OTHER",
]);

export const responsibleRoleSchema = z.enum([
  "ADMIN",
  "OPERATIONS",
  "VISA",
  "FINANCE",
  "GUIDE",
  "MARKETING",
]);

export const readinessDueTypeSchema = z.enum([
  "BEFORE_GROUP_OPENS",
  "BEFORE_FIRST_BOOKING",
  "BEFORE_VISA_SUBMISSION",
  "BEFORE_FINAL_PAYMENT",
  "DAYS_BEFORE_DEPARTURE",
  "BEFORE_DEPARTURE",
]);

export const readinessItemStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETE",
  "AT_RISK",
  "BLOCKED",
  "NOT_REQUIRED",
]);

export const taskStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "COMPLETE",
  "OVERDUE",
]);

export const taskCategorySchema = z.enum([
  "OPERATIONS",
  "VISA",
  "FINANCE",
  "GUIDE",
  "MARKETING",
  "OTHER",
]);

export const templateCopyOptionsSchema = z.object({
  itinerary: z.boolean(),
  inclusionsAndExclusions: z.boolean(),
  travellerRequirements: z.boolean(),
  readinessChecklist: z.boolean(),
  accommodation: z.boolean(),
  transport: z.boolean(),
  flights: z.boolean(),
});

const createMoney = z.number().nonnegative({ error: "Cannot be negative." }).nullable();

/**
 * This departure's own price, cost estimate and flight routing — a template
 * carries none of these (see
 * docs/architecture/package-departure-architecture-master-plan.md), so all three are
 * required inputs on every create, never defaulted from the template.
 */
const createGroupPricingSchema = z.object({
  currency: z.string().trim().min(1).max(8),
  quadPrice: createMoney,
  triplePrice: createMoney,
  doublePrice: createMoney,
  singlePrice: createMoney,
  childPrice: createMoney,
  infantPrice: createMoney,
  earlyBirdPrice: createMoney,
  advanceDeposit: createMoney,
});

const createGroupCostEstimateSchema = z.object({
  flightCostPerPilgrim: createMoney,
  accommodationCostPerPilgrim: createMoney,
  transportCostPerPilgrim: createMoney,
  visaInsuranceCostPerPilgrim: createMoney,
  cateringCostPerPilgrim: createMoney,
  guideOperationsCostPerPilgrim: createMoney,
  contingencyCostPerPilgrim: createMoney,
  fixedCostPerDeparture: z
    .number()
    .nonnegative({ error: "Fixed cost cannot be negative." }),
});

const createGroupFlightRoutingSchema = z.object({
  flightsIncluded: z.boolean(),
  departureOrigin: z.string().trim().max(120),
  arrivalGateway: z.string().trim().max(60),
  returnGateway: z.string().trim().max(60),
  preferredAirline: z.string().trim().max(120),
  cabinClass: z.string().trim().max(40),
});

export const createDepartureGroupSchema = z
  .object({
    packageTemplateId: z
      .string()
      .trim()
      .min(1, { error: "Select a Package Template." }),
    groupName: z
      .string()
      .trim()
      .min(3, { error: "Group name must be at least 3 characters." })
      .max(120, { error: "Group name must be 120 characters or fewer." }),
    groupCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, { error: "Group code must be at least 3 characters." })
      .max(40, { error: "Group code must be 40 characters or fewer." })
      .regex(/^[A-Z0-9-]+$/, {
        error: "Use letters, numbers and hyphens only.",
      }),
    departureDate: isoDate,
    returnDate: isoDate,
    capacity: z
      .number({ error: "Capacity is required." })
      .int({ error: "Capacity must be a whole number." })
      .positive({ error: "Capacity must be greater than zero." })
      .max(2000, { error: "Capacity looks too large." }),
    minimumGroupSize: z
      .number()
      .int({ error: "Minimum group size must be a whole number." })
      .min(0, { error: "Minimum group size cannot be negative." }),
    salesStatus: groupSalesStatusSchema,
    branch: z.string().trim().min(1, { error: "Select a branch." }),
    operationsOwnerName: optionalText,
    primaryGuideName: optionalText,
    waitlistEnabled: z.boolean(),
    seatHoldExpiryHours: z
      .number()
      .int()
      .positive({ error: "Seat hold expiry must be greater than zero." })
      .max(720, { error: "Seat hold expiry cannot exceed 30 days." }),
    copyOptions: templateCopyOptionsSchema,
    /**
     * Admin escape hatch: create a PLANNING group from a template that is not
     * yet open for sale. Checked against the caller's role in `actions.ts`.
     */
    allowDraftTemplate: z.boolean().optional().default(false),
    pricing: createGroupPricingSchema,
    costEstimate: createGroupCostEstimateSchema,
    flightRouting: createGroupFlightRoutingSchema,
  })
  .refine((v) => v.returnDate >= v.departureDate, {
    error: "Return date cannot be before the departure date.",
    path: ["returnDate"],
  })
  .refine((v) => v.capacity >= v.minimumGroupSize, {
    error: "Capacity cannot be below the minimum group size.",
    path: ["capacity"],
  });

/** Suggests a unique group code for the create form, given the chosen template's journey type. */
export const generateGroupCodeSchema = z.object({
  journeyType: z.enum(["UMRAH", "HAJJ", "EARLY_REGISTRATION"]),
  departureDate: isoDate,
});

/**
 * Edits an accommodation block's own details. `roomsAllocated` is derived
 * from the rooms themselves (each room's `assigned_pilgrim_count`), so it is
 * deliberately not writable here — only room assignment mutates it.
 */
const accommodationCitySchema = z.enum([
  "MAKKAH",
  "MADINAH",
  "MINA",
  "ARAFAT",
  "OTHER",
]);

/** Adds a new accommodation block to a group ("Add Hotel"). */
export const createAccommodationSchema = z
  .object({
    departureGroupId: entityId(),
    city: accommodationCitySchema,
    hotelName: z.string().trim().min(1, { error: "Hotel name is required." }),
    supplierName: z.string().trim().nullable().optional(),
    supplierId: optionalEntityId,
    bookingReference: z.string().trim().nullable().optional(),
    status: z.enum([
      "NOT_REQUESTED",
      "REQUESTED",
      "CONFIRMED",
      "COMPLETED",
      "CANCELLED",
    ]),
    checkInDate: isoDate,
    checkOutDate: isoDate,
    roomCapacity: z.number().int().min(0),
    roomsReserved: z.number().int().min(0),
    mealPlan: z.string().trim().nullable().optional(),
    distanceDescription: z.string().trim().nullable().optional(),
    internalCost: z.number().min(0).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.checkOutDate >= v.checkInDate, {
    error: "Check-out cannot be before check-in.",
    path: ["checkOutDate"],
  });

export const updateAccommodationSchema = z
  .object({
    id: entityId(),
    departureGroupId: entityId(),
    hotelName: z.string().trim().min(1, { error: "Hotel name is required." }),
    supplierName: z.string().trim().nullable().optional(),
    supplierId: optionalEntityId,
    bookingReference: z.string().trim().nullable().optional(),
    status: z.enum([
      "NOT_REQUESTED",
      "REQUESTED",
      "CONFIRMED",
      "COMPLETED",
      "CANCELLED",
    ]),
    checkInDate: isoDate,
    checkOutDate: isoDate,
    roomCapacity: z.number().int().min(0),
    roomsReserved: z.number().int().min(0),
    mealPlan: z.string().trim().nullable().optional(),
    distanceDescription: z.string().trim().nullable().optional(),
    internalCost: z.number().min(0).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.checkOutDate >= v.checkInDate, {
    error: "Check-out cannot be before check-in.",
    path: ["checkOutDate"],
  });

/** Attaches a voucher link to an accommodation ("Upload Voucher"). */
export const accommodationVoucherSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  voucherUrl: z.string().trim().url({ error: "Enter a valid voucher URL." }),
});

/** Sets an accommodation's booking reference ("Add Booking Reference"). */
export const accommodationReferenceSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  bookingReference: z
    .string()
    .trim()
    .min(1, { error: "Enter a booking reference." })
    .max(60),
});

export const markAccommodationConfirmedSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
});

/** Assigns one pilgrim to one room ("Assign Manually"). */
export const assignRoomSchema = z.object({
  departureGroupId: entityId(),
  pilgrimId: entityId("Pick a pilgrim."),
  roomId: entityId("Pick a room."),
});

/** Bulk-fills every unassigned pilgrim into available rooms ("Auto Assign Rooms"). */
export const autoAssignRoomsSchema = z.object({
  departureGroupId: entityId(),
  // Scopes the fill to one accommodation/city — see `AutoAssignRoomsInput` in
  // lib/data/departure-groups-rooming.ts for why this is no longer group-wide.
  accommodationId: entityId(),
});

/** Creates the physical room inventory for an accommodation block ("Generate Rooms"). */
export const generateRoomsSchema = z.object({
  accommodationId: entityId(),
  departureGroupId: entityId(),
  roomType: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"]),
  occupancyCapacity: z.number().int().min(1).max(20),
  count: z.number().int().min(1).max(500),
  startingRoomNumber: z.string().trim().max(20).nullable().optional(),
});

/** Reverts a LOCKED room assignment back to ASSIGNED ("Unlock"). */
export const unlockRoomAssignmentSchema = z.object({
  departureGroupId: entityId(),
  pilgrimId: entityId(),
});

/** Edits one room's own details ("Edit Room"). */
export const updateRoomSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  roomNumber: z.string().trim().max(20).nullable().optional(),
  roomType: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"]),
  occupancyCapacity: z.number().int().min(1).max(20),
  blocked: z.boolean(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** Deletes an empty room ("Delete Room"). */
export const deleteRoomSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
});

export const transportSchema = z.object({
  id: z.string().trim().optional(),
  departureGroupId: entityId(),
  templateTransportRequirementId: z.string().trim().nullable().optional(),
  routeLabel: z.string().trim().min(1, { error: "Route label is required." }),
  origin: z.string().trim().min(1, { error: "Origin is required." }),
  destination: z.string().trim().min(1, { error: "Destination is required." }),
  status: z.enum([
    "NOT_REQUESTED",
    "REQUESTED",
    "CONFIRMED",
    "COMPLETED",
    "CANCELLED",
  ]),
  supplierName: z.string().trim().nullable().optional(),
  supplierId: optionalEntityId,
  bookingReference: z.string().trim().nullable().optional(),
  vehicleType: z.enum(["COACH", "VAN", "PRIVATE_CAR", "TRAIN", "OTHER"]),
  vehicleCapacity: z.number().int().min(0).nullable().optional(),
  passengerCount: z.number().int().min(0).nullable().optional(),
  pickupAt: isoDateTime.nullable().optional(),
  pickupLocation: z.string().trim().nullable().optional(),
  driverName: z.string().trim().nullable().optional(),
  driverPhone: z.string().trim().nullable().optional(),
  coordinatorName: z.string().trim().nullable().optional(),
  coordinatorPhone: z.string().trim().nullable().optional(),
  internalCost: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Attaches a confirmation link to a transport route ("Upload Confirmation"). */
export const transportConfirmationSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  confirmationUrl: z
    .string()
    .trim()
    .url({ error: "Enter a valid confirmation URL." }),
});

/** Sets a transport route's booking reference ("Add Reference"). */
export const transportReferenceSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  bookingReference: z
    .string()
    .trim()
    .min(1, { error: "Enter a booking reference." })
    .max(60),
});

export const markTransportConfirmedSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
});

/* ── Documents & visa ─────────────────────────────────────────────────────── */

/* ── Traveller documents ──────────────────────────────────────────────────── */

/**
 * Storage object paths, not URLs.
 *
 * Traveller documents live in a private bucket and are read through short-lived
 * signed URLs, so what the client sends back after an upload is the object key.
 * Accepting an arbitrary URL here would let a caller point a passport record at
 * anything at all, and traversal segments would let it point outside the
 * group's own folder.
 */
const storageObjectPath = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine((value) => !value.includes(".."), {
    error: "That file path is not valid.",
  })
  .refine((value) => /^[A-Za-z0-9/_.\- ]+$/.test(value), {
    error: "That file path is not valid.",
  });

export const submitDocumentSchema = z.object({
  documentId: entityId(),
  departureGroupId: entityId(),
  filePath: storageObjectPath.nullable().optional(),
  fileName: z.string().trim().max(255).nullable().optional(),
  fileSizeBytes: z.number().int().min(0).max(10 * 1024 * 1024).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const verifyDocumentSchema = z.object({
  documentId: entityId(),
  departureGroupId: entityId(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const rejectDocumentSchema = z.object({
  documentId: entityId(),
  departureGroupId: entityId(),
  // A refusal the traveller cannot act on is worse than none: the previous
  // design sent documents back with no reason at all.
  reason: z
    .string()
    .trim()
    .min(3, { error: "Say what is wrong with the document." })
    .max(500),
});

export const waiveDocumentSchema = z.object({
  documentId: entityId(),
  departureGroupId: entityId(),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Say why this requirement does not apply." })
    .max(500),
});

export const updatePilgrimRecordSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  passportNumber: z.string().trim().max(40).nullable().optional(),
  passportExpiry: isoDate.nullable().optional(),
  passportIssueCountry: z.string().trim().max(80).nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  emergencyContactRelationship: z.string().trim().max(60).nullable().optional(),
});

export const markApplicationsSubmittedSchema = z.object({
  departureGroupId: entityId(),
  pilgrimIds: z
    .array(z.string().trim().min(1))
    .min(1, { error: "Select at least one pilgrim." }),
});

export const markVisasUnderReviewSchema = z.object({
  departureGroupId: entityId(),
  pilgrimIds: z
    .array(z.string().trim().min(1))
    .min(1, { error: "Select at least one application." }),
  note: z.string().trim().max(500).nullable().optional(),
});

export const uploadVisaSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  visaId: z.string().trim().min(1, { error: "Enter the visa ID." }).max(60),
  filePath: storageObjectPath.nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  issueNote: z.string().trim().max(500).nullable().optional(),
});

export const uploadTicketSchema = z.object({
  pilgrimId: entityId(),
  departureGroupId: entityId(),
  filePath: storageObjectPath,
  fileName: z.string().trim().min(1).max(200),
});

export const rejectVisaSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Record the refusal reason given by the consulate." })
    .max(500),
  canReapply: z.boolean(),
});

export const flagFlightIssueSchema = z.object({
  pilgrimId: entityId(),
  departureGroupId: entityId(),
  issue: z.enum(["NAME_MISMATCH", "CHANGE_REQUESTED", "RESOLVED"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const promoteWaitlistSchema = z.object({
  departureGroupId: entityId(),
  bookingId: entityId().optional(),
});

export const releaseExpiredHoldsSchema = z.object({
  departureGroupId: entityId(),
});

export const groupBookingSchema = z
  .object({
    id: z.string().trim().optional(),
    departureGroupId: entityId(),
    leadId: optionalEntityId,
    bookingReference: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, { error: "Booking reference is required." })
      .max(40, { error: "Keep the booking reference under 40 characters." }),
    bookingStatus: z.enum([
      "HELD",
      "DEPOSIT_PENDING",
      "CONFIRMED",
      "CANCELLED",
      "WAITLIST",
    ]),
    primaryContactName: z
      .string()
      .trim()
      .min(2, { error: "Primary contact name is required." })
      .max(120, { error: "Keep the name under 120 characters." }),
    primaryContactPhone: phoneNumberSchema,
    travellerCount: z
      .number()
      .int()
      .positive({ error: "A booking needs at least one traveller." })
      .max(50, { error: "Split bookings larger than 50 travellers." }),
    roomOccupancyPreference: roomTypeSchema,
    packagePricePerPerson: z.number().min(0).max(MAX_MONEY, { error: "That amount looks too large." }),
    amountPaid: z.number().min(0).max(MAX_MONEY, { error: "That amount looks too large." }),
    seatHoldExpiresAt: isoDateTime.nullable().optional(),
    travellers: z
      .array(
        z.object({
          fullName: z
            .string()
            .trim()
            .min(2, { error: "Each traveller needs a name." })
            .max(120, { error: "Keep each name under 120 characters." }),
          phone: z.string().trim().max(25, { error: "That phone number is too long." }).optional(),
          passportNumber: passportNumberSchema.optional(),
          // A child/infant priced below the booking's adult rate — omitted
          // falls back to `packagePricePerPerson` (see `BookingTravellerInput`).
          pricePerPerson: z.number().min(0).max(MAX_MONEY, { error: "That amount looks too large." }).optional(),
        }),
      )
      .max(50, { error: "Split bookings larger than 50 travellers." })
      .optional(),
  })
  .refine((v) => v.amountPaid <= v.packagePricePerPerson * v.travellerCount, {
    error: "Amount paid cannot exceed the total booking value.",
    path: ["amountPaid"],
  })
  .refine(
    (v) => !v.travellers || v.travellers.length === v.travellerCount,
    {
      error: "Traveller details must match the number of travellers.",
      path: ["travellers"],
    },
  );

export const recordPaymentSchema = z.object({
  bookingId: entityId(),
  departureGroupId: entityId(),
  amount: z
    .number({ error: "Enter a payment amount." })
    .positive({ error: "Payment must be greater than zero." })
    .max(1_000_000_000, { error: "That amount looks too large." }),
  method: z
    .enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "ONLINE"])
    .optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Room occupancy lives on the booking, so this changes the tier for every
 * traveller on it. `pricePerPerson` is optional — omitting it keeps the booking
 * priced as-is; `actions.ts` additionally requires a pricing capability before
 * honouring it.
 */
export const changeRoomPreferenceSchema = z.object({
  bookingId: entityId(),
  departureGroupId: entityId(),
  roomOccupancyPreference: roomTypeSchema,
  pricePerPerson: z
    .number({ error: "Enter a package price." })
    .min(0, { error: "Package price cannot be negative." })
    .max(1_000_000_000, { error: "That amount looks too large." })
    .optional(),
  releaseRoomAssignments: z.boolean().optional().default(false),
  note: z.string().trim().max(500).optional(),
});

/**
 * Moves a booking and everyone on it to another departure group. Target
 * capacity, status and archival are store facts, so `departure-groups-bookings`
 * checks those after parsing; `pricePerPerson` needs a pricing capability, which
 * `actions.ts` checks.
 */
export const moveBookingSchema = z
  .object({
    bookingId: entityId(),
    fromGroupId: entityId(),
    toGroupId: z
      .string()
      .trim()
      .min(1, { error: "Pick the group to move this booking into." }),
    pricePerPerson: z
      .number({ error: "Enter a package price." })
      .min(0, { error: "Package price cannot be negative." })
      .max(1_000_000_000, { error: "That amount looks too large." })
      .optional(),
    reissueReference: z.boolean().optional().default(false),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.toGroupId !== v.fromGroupId, {
    error: "That booking is already in this group.",
    path: ["toGroupId"],
  });

/**
 * A payment or document reminder against a booking. The draft is stored on the
 * activity trail verbatim, so it is validated like content rather than waved
 * through — an empty reminder is not a reminder.
 */
export const bookingReminderSchema = z.object({
  bookingId: entityId(),
  departureGroupId: entityId(),
  kind: z.enum(["PAYMENT", "DOCUMENT"]),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  message: z
    .string()
    .trim()
    .min(10, { error: "Write a message of at least 10 characters." })
    .max(2000, { error: "Keep the reminder under 2000 characters." }),
  recipientName: z
    .string()
    .trim()
    .min(2, { error: "Who is this reminder addressed to?" })
    .max(120, { error: "Keep the name under 120 characters." }),
  recipientPhone: z
    .string()
    .trim()
    .min(5, { error: "A reminder needs a reachable phone or email." })
    .max(200, { error: "That contact is too long." }),
});

/**
 * Corrects a booking's primary contact name/phone — the same limits
 * `createGroupBookingSchema` enforces at creation time, since this is fixing
 * the same two fields rather than a different, looser edit path for them.
 */
export const editBookingSchema = z.object({
  bookingId: entityId(),
  departureGroupId: entityId(),
  primaryContactName: z
    .string()
    .trim()
    .min(2, { error: "Primary contact name is required." })
    .max(120, { error: "Keep the name under 120 characters." }),
  primaryContactPhone: phoneNumberSchema,
});

export const setBookingPayerSchema = z
  .object({
    bookingId: entityId(),
    departureGroupId: entityId(),
    payerPilgrimId: entityId().nullable().optional(),
    payerLeadId: entityId().nullable().optional(),
    payerName: z.string().trim().max(200).nullable().optional(),
    payerEmail: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .refine((v) => !v || z.email().safeParse(v).success, {
        error: "Enter a valid email.",
      }),
    bookingType: z.enum(["GROUP", "CUSTOM"]).optional(),
  })
  .refine(
    (v) => Boolean(v.payerPilgrimId || v.payerLeadId || v.payerName?.trim()),
    {
      error: "Identify the payer by name, or link a pilgrim or lead.",
      path: ["payerName"],
    },
  );

export const addTravellerRelationshipSchema = z
  .object({
    bookingId: entityId(),
    departureGroupId: entityId(),
    fromPilgrimId: entityId(),
    toPilgrimId: entityId(),
    relationship: z.enum([
      "MAHRAM",
      "SPOUSE",
      "PARENT",
      "CHILD",
      "SIBLING",
      "COMPANION",
      "OTHER",
    ]),
    isMahram: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.fromPilgrimId !== v.toPilgrimId, {
    error: "A traveller cannot be related to themselves.",
    path: ["toPilgrimId"],
  });

export const removeTravellerRelationshipSchema = z.object({
  relationshipId: entityId(),
  bookingId: entityId(),
  departureGroupId: entityId(),
});

/**
 * Cancels a booking. The reason is required — a cancellation without one is
 * unanswerable three weeks later — and the refund is capped against what was
 * actually collected by `departure-groups-bookings`.
 */
export const cancelBookingSchema = z.object({
  bookingId: entityId(),
  departureGroupId: entityId(),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Give a reason for the cancellation." })
    .max(500, { error: "Keep the reason under 500 characters." }),
  refundAmount: z
    .number({ error: "Enter a refund amount." })
    .min(0, { error: "A refund cannot be negative." })
    .max(1_000_000_000, { error: "That amount looks too large." })
    .optional(),
});

/**
 * Creates or edits a flight sector (Outbound / Return). Legs are managed
 * separately by `addFlightLegSchema` — this never touches them. Ticketing
 * counts (`seatsTicketed`) are likewise out of scope here: they only move
 * through `flightTicketingSchema` / `markFlightTicketsIssuedSchema`, so a
 * routine detail edit can never silently un-ticket seats.
 */
export const upsertFlightSchema = z
  .object({
    id: z.string().trim().optional(),
    departureGroupId: entityId(),
    direction: z.enum(["OUTBOUND", "RETURN"]),
    status: z.enum(["DRAFT", "HELD", "CONFIRMED", "TICKETED", "CANCELLED"]),
    airline: z.string().trim().min(1, { error: "Airline is required." }),
    flightNumber: z.string().trim().min(1).nullable().optional(),
    pnr: z.string().trim().max(20).nullable().optional(),
    bookingReference: z.string().trim().max(40).nullable().optional(),
    originAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    originAirportName: z
      .string()
      .trim()
      .min(1, { error: "Origin airport name is required." }),
    destinationAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    destinationAirportName: z
      .string()
      .trim()
      .min(1, { error: "Destination airport name is required." }),
    departureAt: isoDateTime,
    arrivalAt: isoDateTime,
    /**
     * The operator's local calendar date for departure/arrival (YYYY-MM-DD).
     * Used for the trip-window check so a timezone shift on `departureAt`
     * doesn't quietly move the flight to the previous UTC day and let a
     * clearly-out-of-window flight through.
     */
    departureLocalDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Bad local date." })
      .optional(),
    arrivalLocalDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Bad local date." })
      .optional(),
    cabinClass: z.string().trim().min(1, { error: "Cabin class is required." }),
    seatCapacity: z
      .number()
      .int()
      .min(0, { error: "Seat capacity cannot be negative." }),
    seatsHeld: z.number().int().min(0, { error: "Seats held cannot be negative." }),
    ticketingDeadline: isoDateTime.nullable().optional(),
    supplierName: z.string().trim().nullable().optional(),
    supplierId: optionalEntityId,
    notes: z.string().trim().max(2000).nullable().optional(),
    /**
     * New transit legs to append to this flight in the same request.
     * Existing (already saved) legs are immutable through this endpoint —
     * only append is supported, to keep leg chronology and layover
     * recomputation deterministic.
     */
    newLegs: z
      .array(
        z
          .object({
            airline: z.string().trim().min(1, { error: "Airline is required." }),
            flightNumber: z
              .string()
              .trim()
              .min(2, { error: "Flight number is required." }),
            originAirportCode: z
              .string()
              .trim()
              .toUpperCase()
              .length(3, { error: "Use a 3-letter IATA code." }),
            destinationAirportCode: z
              .string()
              .trim()
              .toUpperCase()
              .length(3, { error: "Use a 3-letter IATA code." }),
            departureAt: isoDateTime,
            arrivalAt: isoDateTime,
          })
          .refine((v) => v.arrivalAt >= v.departureAt, {
            error: "Arrival cannot be before departure.",
            path: ["arrivalAt"],
          }),
      )
      .optional(),
  })
  .refine((v) => v.arrivalAt >= v.departureAt, {
    error: "Arrival cannot be before departure.",
    path: ["arrivalAt"],
  })
  .refine((v) => v.seatsHeld <= v.seatCapacity, {
    error: "Seats held cannot exceed seat capacity.",
    path: ["seatsHeld"],
  })
  .refine((v) => !v.ticketingDeadline || v.ticketingDeadline <= v.departureAt, {
    error: "Ticketing deadline cannot be after the flight's departure.",
    path: ["ticketingDeadline"],
  });

/**
 * Appends one transit leg to an existing flight. `legOrder` and
 * `transitDurationMinutes` are computed server-side from the flight's
 * existing legs, not supplied by the client — a client-picked order could
 * collide, and the layover is derived from real timestamps rather than typed
 * in by hand.
 */
export const addFlightLegSchema = z
  .object({
    flightId: entityId(),
    departureGroupId: entityId(),
    airline: z.string().trim().min(1, { error: "Airline is required." }),
    flightNumber: z
      .string()
      .trim()
      .min(2, { error: "Flight number is required." }),
    originAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    destinationAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    departureAt: isoDateTime,
    arrivalAt: isoDateTime,
  })
  .refine((v) => v.arrivalAt >= v.departureAt, {
    error: "Arrival cannot be before departure.",
    path: ["arrivalAt"],
  });

/** Corrects an already-saved transit leg's own fields — the edit `addFlightLegSchema` never covered. */
export const updateFlightLegSchema = z
  .object({
    legId: entityId(),
    departureGroupId: entityId(),
    airline: z.string().trim().min(1, { error: "Airline is required." }),
    flightNumber: z
      .string()
      .trim()
      .min(2, { error: "Flight number is required." }),
    originAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    destinationAirportCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, { error: "Use a 3-letter IATA code." }),
    departureAt: isoDateTime,
    arrivalAt: isoDateTime,
  })
  .refine((v) => v.arrivalAt >= v.departureAt, {
    error: "Arrival cannot be before departure.",
    path: ["arrivalAt"],
  });

/** Removes one transit leg from a flight's itinerary. */
export const removeFlightLegSchema = z.object({
  legId: entityId(),
  departureGroupId: entityId(),
});

/** Attaches a PNR / booking code to a flight ("Upload Ticket / PNR"). */
export const flightTicketingSchema = z.object({
  flightId: entityId(),
  departureGroupId: entityId(),
  pnr: z
    .string()
    .trim()
    .min(3, { error: "Enter the PNR / booking code." })
    .max(20, { error: "Keep the PNR under 20 characters." }),
  bookingReference: z.string().trim().max(40).nullable().optional(),
});

/** Bulk-flips a flight's held seats to ticketed ("Mark Tickets Issued"). */
export const markFlightTicketsIssuedSchema = z.object({
  flightId: entityId(),
  departureGroupId: entityId(),
});

/* ── Readiness checklist ──────────────────────────────────────────────────── */

/**
 * One edit to a readiness requirement. Every field is optional because the
 * Readiness tab writes this row from six different entry points — assign an
 * owner, move the due date, attach evidence, mark complete/blocked/not
 * required — and each of them must leave the fields it did not touch alone.
 * `completedAt` / `completedBy` are stamped server-side, never accepted here.
 */
export const updateReadinessItemSchema = z
  .object({
    id: entityId(),
    departureGroupId: entityId(),
    status: readinessItemStatusSchema.optional(),
    assignedToName: z
      .string()
      .trim()
      .max(120, { error: "Keep the owner name under 120 characters." })
      .nullable()
      .optional(),
    dueAt: isoDateTime.nullable().optional(),
    evidenceUrl: z
      .string()
      .trim()
      .url({ error: "Enter a valid evidence URL." })
      .nullable()
      .optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.assignedToName !== undefined ||
      v.dueAt !== undefined ||
      v.evidenceUrl !== undefined ||
      v.notes !== undefined ||
      v.required !== undefined,
    { error: "Nothing was changed." },
  );

/* ── Tasks ────────────────────────────────────────────────────────────────── */

/**
 * Creates a task against a group. `status` is absent by design — a new task is
 * OPEN, or OVERDUE when it is written up against a date that has already
 * passed, and that is decided server-side from the due date.
 */
export const createGroupTaskSchema = z.object({
  departureGroupId: entityId(),
  title: z
    .string()
    .trim()
    .min(3, { error: "Give the task a title of at least 3 characters." })
    .max(160, { error: "Keep the title under 160 characters." }),
  description: z.string().trim().max(2000).nullable().optional(),
  ownerName: z.string().trim().min(1, { error: "Assign an owner." }).max(120, { error: "Keep the owner name under 120 characters." }),
  dueAt: isoDateTime,
  category: taskCategorySchema,
  linkedReadinessItemId: optionalEntityId,
});

export const updateGroupTaskStatusSchema = z.object({
  id: entityId(),
  departureGroupId: entityId(),
  status: taskStatusSchema,
});

/* ── Group lifecycle ──────────────────────────────────────────────────────── */

/**
 * A reprice. Every occupancy price is independently optional so an operator
 * can adjust just one tier. `currency` is included because a departure
 * priced off a template denominated in one currency can be sold in another,
 * but is rarely changed alone.
 */
const nonNegativeMoney = z
  .number()
  .nonnegative({ error: "Price cannot be negative." })
  .nullable();

export const groupPricingInputSchema = z
  .object({
    currency: z.string().trim().min(1).max(8).optional(),
    quadPrice: nonNegativeMoney.optional(),
    triplePrice: nonNegativeMoney.optional(),
    doublePrice: nonNegativeMoney.optional(),
    singlePrice: nonNegativeMoney.optional(),
    childPrice: nonNegativeMoney.optional(),
    infantPrice: nonNegativeMoney.optional(),
    earlyBirdPrice: nonNegativeMoney.optional(),
    advanceDeposit: nonNegativeMoney.optional(),
  })
  .refine(
    (v) =>
      v.advanceDeposit == null ||
      v.quadPrice == null ||
      v.advanceDeposit <= v.quadPrice,
    {
      // Only catches a reprice that sends both fields together (the edit
      // sheet always does) — a partial update that omits `quadPrice` has no
      // stored price here to compare against; `updateGroupDetailsInStore`
      // re-checks against the group's current price for that case.
      error: "Advance deposit cannot exceed the Quad price.",
      path: ["advanceDeposit"],
    },
  );

/**
 * Edits a group's own details. Duration, seat counts and readiness due dates
 * are all derived from these fields rather than supplied alongside them, so
 * they are deliberately absent — `departure-groups-lifecycle` recomputes them.
 */
export const updateGroupDetailsSchema = z
  .object({
    groupId: entityId(),
    groupName: z
      .string()
      .trim()
      .min(3, { error: "Group name must be at least 3 characters." })
      .max(120, { error: "Group name must be 120 characters or fewer." })
      .optional(),
    groupCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, { error: "Group code must be at least 3 characters." })
      .max(40, { error: "Group code must be 40 characters or fewer." })
      .regex(/^[A-Z0-9-]+$/, {
        error: "Use letters, numbers and hyphens only.",
      })
      .optional(),
    departureDate: isoDate.optional(),
    returnDate: isoDate.optional(),
    capacity: z
      .number()
      .int({ error: "Capacity must be a whole number." })
      .positive({ error: "Capacity must be greater than zero." })
      .max(2000, { error: "Capacity looks too large." })
      .optional(),
    minimumGroupSize: z
      .number()
      .int({ error: "Minimum group size must be a whole number." })
      .min(0, { error: "Minimum group size cannot be negative." })
      .optional(),
    salesStatus: groupSalesStatusSchema.optional(),
    branch: z.string().trim().min(1, { error: "Select a branch." }).optional(),
    operationsOwnerName: z.string().trim().max(120).nullable().optional(),
    primaryGuideName: z.string().trim().max(120).nullable().optional(),
    visaOwnerName: z.string().trim().max(120).nullable().optional(),
    financeOwnerName: z.string().trim().max(120).nullable().optional(),
    localCoordinatorName: z.string().trim().max(120).nullable().optional(),
    localCoordinatorPhone: z.string().trim().max(40).nullable().optional(),
    waitlistEnabled: z.boolean().optional(),
    seatHoldExpiryHours: z
      .number()
      .int()
      .positive({ error: "Seat hold expiry must be greater than zero." })
      .max(720, { error: "Seat hold expiry cannot exceed 30 days." })
      .optional(),
    // Present only from a caller with the reprice capability — the Server
    // Action strips it for anyone else before this schema ever sees it, so a
    // request that reaches here with `pricing` set has already been
    // authorized.
    pricing: groupPricingInputSchema.optional(),
    costEstimate: z
      .object({
        fixedCostPerDeparture: z
          .number()
          .nonnegative({ error: "Fixed cost cannot be negative." })
          .optional(),
      })
      .optional(),
    // Masar Nusuk / regulatory identifiers — the Server Action strips these
    // for anyone without `manageDocumentsAndVisa` before this schema runs.
    umrahCompanyName: z.string().trim().max(200).nullable().optional(),
    nusukProgramRef: z.string().trim().max(120).nullable().optional(),
    nusukGroupRef: z.string().trim().max(120).nullable().optional(),
    visaBatchRef: z.string().trim().max(120).nullable().optional(),
    visaInvoiceRef: z.string().trim().max(120).nullable().optional(),
    nusukStatus: z
      .enum([
        "NOT_LINKED",
        "PROGRAM_LINKED",
        "GROUP_SUBMITTED",
        "INVOICE_PENDING",
        "INVOICE_PAID",
        "VISAS_ISSUED",
        "REJECTED",
      ])
      .optional(),
  })
  .refine(
    (v) =>
      v.departureDate === undefined ||
      v.returnDate === undefined ||
      v.returnDate >= v.departureDate,
    {
      error: "Return date cannot be before the departure date.",
      path: ["returnDate"],
    },
  );

/**
 * A group-level lifecycle transition. Cancelling requires a reason: it
 * withdraws every booking on the group, and "why" is the first question asked
 * three weeks later.
 */
export const groupLifecycleSchema = z
  .object({
    groupId: entityId(),
    action: z.enum([
      "CLOSE_SALES",
      "REOPEN_SALES",
      "MARK_READY",
      "MARK_DEPARTED",
      "MARK_COMPLETED",
      "CLOSE_GROUP",
      "CANCEL",
    ]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => v.action !== "CANCEL" || (v.reason?.trim().length ?? 0) >= 3,
    {
      error: "Give a reason for cancelling this group.",
      path: ["reason"],
    },
  );

/* ── Per-pilgrim customisation ────────────────────────────────────────────── */

export const chargeTypeSchema = z.enum([
  "ROOM_UPGRADE",
  "EXTRA_NIGHTS",
  "FLIGHT_VARIATION",
  "TRANSPORT_VARIATION",
  "ADDON",
  "DISCOUNT",
  "SURCHARGE",
  "PRICE_CORRECTION",
  "CANCELLATION_FEE",
]);

export const deviationTypeSchema = z.enum([
  "ROOM_TYPE",
  "EXTRA_NIGHTS",
  "HOTEL_UPGRADE",
  "MEAL_PLAN",
  "ROOMMATE_REQUEST",
  "LAND_ONLY",
  "OWN_FLIGHT",
  "EXTENDED_STAY",
  "CABIN_UPGRADE",
  "SEAT_PREFERENCE",
  "PRIVATE_TRANSFER",
  "PICKUP_POINT",
  "ITINERARY_OPT_OUT",
  "ITINERARY_ADDITION",
  "SERVICE_ADDON",
  "DOCUMENT_REQUIREMENT",
  "ASSISTANCE",
  "OTHER",
]);

/** A traveller's base fare, set once at booking and editable per traveller thereafter. */
export const setBaseFareSchema = z.object({
  departureGroupId: entityId(),
  groupPilgrimId: entityId(),
  amount: z
    .number({ error: "Enter a base fare." })
    .min(0, { error: "Base fare cannot be negative." })
    .max(1_000_000_000, { error: "That amount looks too large." }),
  roomType: roomTypeSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export const setPilgrimRoomTypeSchema = z.object({
  departureGroupId: entityId(),
  groupPilgrimId: entityId(),
  roomOccupancyType: roomTypeSchema,
});

/**
 * A priced line on one traveller — a discount, surcharge, add-on or
 * correction. `BASE_FARE` is excluded: that goes through `setBaseFareSchema`
 * so there is exactly one code path that can ever create or replace it.
 */
export const addChargeSchema = z
  .object({
    departureGroupId: entityId(),
    groupPilgrimId: entityId(),
    chargeType: chargeTypeSchema,
    addonId: entityId().optional(),
    label: z.string().trim().min(2, { error: "Give this charge a label." }).max(200),
    amount: z
      .number({ error: "Enter an amount." })
      .refine((v) => v !== 0, { error: "Enter a non-zero amount." })
      .refine((v) => Math.abs(v) <= 1_000_000_000, { error: "That amount looks too large." }),
    quantity: z.number().positive().max(1000).optional(),
    reason: z.string().trim().max(500).optional(),
    requiresApproval: z.boolean().optional().default(false),
  })
  .refine((v) => v.chargeType !== "DISCOUNT" || v.amount < 0, {
    error: "A discount must be a negative amount.",
    path: ["amount"],
  })
  .refine((v) => v.chargeType === "DISCOUNT" || v.amount > 0, {
    error: "That charge type cannot be negative.",
    path: ["amount"],
  });

export const voidChargeSchema = z.object({
  departureGroupId: entityId(),
  chargeId: entityId(),
  reason: z.string().trim().min(3, { error: "A reason is required to void a charge." }).max(500),
});

export const approveChargeSchema = z.object({
  departureGroupId: entityId(),
  chargeId: entityId(),
});

const vehicleTypeSchema = z.enum([
  "COACH",
  "VAN",
  "PRIVATE_CAR",
  "TRAIN",
  "OTHER",
]);

const documentStageSchema = z.enum([
  "ON_BOOKING",
  "BEFORE_VISA_SUBMISSION",
  "BEFORE_FINAL_PAYMENT",
  "BEFORE_DEPARTURE",
]);

const roomTypeDetailSchema = z.object({
  kind: z.literal("ROOM_TYPE"),
  roomType: roomTypeSchema,
  roommatePilgrimIds: z.array(z.string().trim().min(1)).optional(),
});

const extraNightsDetailSchema = z.object({
  kind: z.literal("EXTRA_NIGHTS"),
  accommodationId: entityId().nullable(),
  city: accommodationCitySchema,
  nights: z.number().int().positive().max(60),
  side: z.enum(["BEFORE", "AFTER"]),
  checkInDate: isoDate.optional(),
  checkOutDate: isoDate.optional(),
});

const hotelUpgradeDetailSchema = z.object({
  kind: z.literal("HOTEL_UPGRADE"),
  fromAccommodationId: entityId().nullable(),
  city: accommodationCitySchema,
  hotelName: z.string().trim().min(1, { error: "Enter the hotel name." }),
  supplierName: z.string().trim().optional(),
  distanceDescription: z.string().trim().optional(),
  bookingReference: z.string().trim().optional(),
  checkInDate: isoDate.optional(),
  checkOutDate: isoDate.optional(),
});

const mealPlanDetailSchema = z.object({
  kind: z.literal("MEAL_PLAN"),
  accommodationId: entityId().nullable(),
  mealPlan: z.string().trim().min(1, { error: "Specify the meal plan." }),
});

const roommateRequestDetailSchema = z.object({
  kind: z.literal("ROOMMATE_REQUEST"),
  withPilgrimIds: z.array(z.string().trim().min(1)).min(1, { error: "Select at least one traveller." }),
  note: z.string().trim().optional(),
});

const ownFlightDetailSchema = z.object({
  kind: z.literal("OWN_FLIGHT"),
  replacesFlightIds: z.array(z.string().trim().min(1)),
  direction: z.enum(["OUTBOUND", "RETURN", "BOTH"]),
  airline: z.string().trim().min(1, { error: "Enter the airline." }),
  flightNumber: z.string().trim().optional(),
  pnr: z.string().trim().optional(),
  originAirportCode: z.string().trim().optional(),
  destinationAirportCode: z.string().trim().optional(),
  departureAt: isoDateTime.optional(),
  arrivalAt: isoDateTime.optional(),
  arrivesWithGroup: z.boolean(),
});

const landOnlyDetailSchema = z.object({
  kind: z.literal("LAND_ONLY"),
  replacesFlightIds: z.array(z.string().trim().min(1)),
  note: z.string().trim().optional(),
});

const cabinUpgradeDetailSchema = z.object({
  kind: z.literal("CABIN_UPGRADE"),
  flightId: entityId(),
  fromCabin: z.string().trim().min(1),
  toCabin: z.string().trim().min(1),
  pnr: z.string().trim().optional(),
});

const seatPreferenceDetailSchema = z.object({
  kind: z.literal("SEAT_PREFERENCE"),
  flightId: entityId(),
  preference: z.enum(["WINDOW", "AISLE", "EXTRA_LEGROOM", "BULKHEAD", "TOGETHER", "OTHER"]),
  note: z.string().trim().optional(),
});

const extendedStayDetailSchema = z.object({
  kind: z.literal("EXTENDED_STAY"),
  returnFlightId: entityId().nullable(),
  newReturnDate: isoDate,
  onwardArrangement: z.string().trim().min(1, { error: "Describe how the traveller returns." }),
});

const itineraryOptOutDetailSchema = z.object({
  kind: z.literal("ITINERARY_OPT_OUT"),
  itineraryItemIds: z.array(z.string().trim().min(1)).min(1, { error: "Select at least one itinerary day." }),
  reason: z.string().trim().optional(),
});

const itineraryAdditionDetailSchema = z.object({
  kind: z.literal("ITINERARY_ADDITION"),
  title: z.string().trim().min(1, { error: "Give this activity a title." }),
  dayNumber: z.number().int().positive().nullable(),
  location: z.string().trim().min(1, { error: "Specify a location." }),
  description: z.string().trim().max(1000).default(""),
  scheduledAt: isoDateTime.optional(),
  supplierName: z.string().trim().optional(),
});

const serviceAddonDetailSchema = z.object({
  kind: z.literal("SERVICE_ADDON"),
  addonId: entityId().nullable(),
  addonCode: z.string().trim().optional(),
  quantity: z.number().positive().max(100).default(1),
  note: z.string().trim().optional(),
});

const privateTransferDetailSchema = z.object({
  kind: z.literal("PRIVATE_TRANSFER"),
  transportId: entityId().nullable(),
  route: z.string().trim().min(1, { error: "Describe the route." }),
  vehicleType: vehicleTypeSchema,
  pickupAt: isoDateTime.optional(),
});

const pickupPointDetailSchema = z.object({
  kind: z.literal("PICKUP_POINT"),
  transportId: entityId().nullable(),
  pickupLocation: z.string().trim().min(1, { error: "Specify the pickup location." }),
  pickupAt: isoDateTime.optional(),
});

const documentRequirementDetailSchema = z.object({
  kind: z.literal("DOCUMENT_REQUIREMENT"),
  documentName: z.string().trim().min(1, { error: "Name the document." }),
  requiredByStage: documentStageSchema,
});

const assistanceDetailSchema = z.object({
  kind: z.literal("ASSISTANCE"),
  assistanceType: z.enum(["WHEELCHAIR", "MEDICAL", "DIETARY", "MOBILITY", "OTHER"]),
  details: z.string().trim().min(1, { error: "Describe the assistance needed." }),
});

const otherDetailSchema = z.object({
  kind: z.literal("OTHER"),
  note: z.string().trim().min(1, { error: "Describe the deviation." }),
});

export const deviationDetailSchema = z.discriminatedUnion("kind", [
  roomTypeDetailSchema,
  extraNightsDetailSchema,
  hotelUpgradeDetailSchema,
  mealPlanDetailSchema,
  roommateRequestDetailSchema,
  ownFlightDetailSchema,
  landOnlyDetailSchema,
  cabinUpgradeDetailSchema,
  seatPreferenceDetailSchema,
  extendedStayDetailSchema,
  itineraryOptOutDetailSchema,
  itineraryAdditionDetailSchema,
  serviceAddonDetailSchema,
  privateTransferDetailSchema,
  pickupPointDetailSchema,
  documentRequirementDetailSchema,
  assistanceDetailSchema,
  otherDetailSchema,
]);

export const requestDeviationSchema = z.object({
  departureGroupId: entityId(),
  groupPilgrimId: entityId(),
  deviationType: deviationTypeSchema,
  summary: z.string().trim().min(3, { error: "Describe the deviation in one line." }).max(300),
  detail: deviationDetailSchema,
  chargeId: entityId().optional(),
  blocksDeparture: z.boolean().optional(),
  responsibleRole: responsibleRoleSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const decideDeviationSchema = z
  .object({
    departureGroupId: entityId(),
    deviationId: entityId(),
    approve: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.approve || (v.note?.trim().length ?? 0) > 0, {
    error: "A decline needs a reason.",
    path: ["note"],
  });

export const markDeviationArrangedSchema = z.object({
  departureGroupId: entityId(),
  deviationId: entityId(),
  supplierCommitmentId: entityId().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const cancelDeviationSchema = z.object({
  departureGroupId: entityId(),
  deviationId: entityId(),
  reason: z.string().trim().min(3, { error: "A reason is required to cancel a deviation." }).max(500),
});

export const requestDeviationWithChargeSchema = z.object({
  departureGroupId: entityId(),
  groupPilgrimId: entityId(),
  deviationType: deviationTypeSchema,
  summary: z.string().trim().min(3, { error: "Describe the deviation in one line." }).max(300),
  detail: deviationDetailSchema,
  blocksDeparture: z.boolean().optional(),
  responsibleRole: responsibleRoleSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  charge: z
    .object({
      chargeType: chargeTypeSchema,
      addonId: entityId().optional(),
      label: z.string().trim().min(2, { error: "Give this charge a label." }).max(200),
      amount: z
        .number({ error: "Enter an amount." })
        .refine((v) => v !== 0, { error: "Enter a non-zero amount." })
        .refine((v) => Math.abs(v) <= 1_000_000_000, { error: "That amount looks too large." }),
      quantity: z.number().positive().max(1000).optional().default(1),
      requiresApproval: z.boolean().optional().default(false),
      reason: z.string().trim().max(500).optional(),
    })
    .optional(),
});

export type DepartureGroupFieldErrors = Record<string, string[] | undefined>;

/** Turns a failed `safeParse` into the flat map the create form renders. */
export function toDepartureGroupFieldErrors(
  error: z.ZodError,
): DepartureGroupFieldErrors {
  return z.flattenError(error).fieldErrors as DepartureGroupFieldErrors;
}

/* ── Departure operations agent ───────────────────────────────────────────── */

/** Longest a person may mute the agent on one group in a single action. */
export const AGENT_MUTE_MAX_DAYS = 90;

/** Biggest edited payload accepted for a proposal, as serialised JSON. */
const MAX_EDITED_PAYLOAD_CHARS = 20_000;

export const approveAgentProposalSchema = z.object({
  proposalId: z.uuid({ error: "That proposal reference is invalid." }),
  editedPayload: z
    .unknown()
    .refine(
      (value) => {
        if (value === undefined) return true;
        try {
          return JSON.stringify(value).length <= MAX_EDITED_PAYLOAD_CHARS;
        } catch {
          return false;
        }
      },
      { error: "The edited proposal is too large." },
    )
    .optional(),
});

export const rejectAgentProposalSchema = z.object({
  proposalId: z.uuid({ error: "That proposal reference is invalid." }),
  decisionNote: z.string().trim().max(500, { error: "Keep the note under 500 characters." }).optional(),
});

/** `days: null` un-mutes. */
export const muteAgentOnGroupSchema = z.object({
  groupId: z.uuid({ error: "That departure group reference is invalid." }),
  days: z
    .number({ error: "Choose how many days to mute for." })
    .int({ error: "Days must be a whole number." })
    .min(1, { error: "Mute for at least one day." })
    .max(AGENT_MUTE_MAX_DAYS, { error: `Mute for at most ${AGENT_MUTE_MAX_DAYS} days.` })
    .nullable(),
  reason: z.string().trim().max(300, { error: "Keep the reason under 300 characters." }),
});

/* ── Erasing a traveller's sensitive details ──────────────────────────────── */

/** `confirm` must be literally true: the screen asks first, and a hand-made request has to say so too. */
export const eraseTravellerDataSchema = z.object({
  departureGroupId: entityId(),
  pilgrimId: entityId(),
  confirm: z.literal(true, { error: "Confirm the erasure to continue." }),
});
