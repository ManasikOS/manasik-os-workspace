import { z } from "zod";

import { LANGUAGE_OPTIONS } from "@/lib/data/settings-copy";
import { SETUP_STEP_IDS } from "@/lib/setup/setup-steps";

import { resetPasswordSchema } from "./auth";

const setupStepId = z.enum(SETUP_STEP_IDS, { error: "Unknown setup step." });

export const setupStepSkipSchema = z.object({ stepId: setupStepId });

/** Validates the `?step=` query value; anything unrecognised means "no step chosen". */
export const setupStepViewSchema = z
  .union([setupStepId, z.literal("finish")])
  .optional()
  .catch(undefined);

export type SetupStepSkipInput = z.infer<typeof setupStepSkipSchema>;

/** Setting a password from the setup guide follows exactly the reset-password rules. */
export const setupPasswordSchema = resetPasswordSchema;

const LANGUAGE_VALUES = LANGUAGE_OPTIONS.map((option) => option.value) as [string, ...string[]];

/** Step 2 — the fields the basics form edits. Timezone must look like an IANA identifier (`Europe/London`, `UTC`). */
export const agencyBasicsSchema = z.object({
  agencyName: z.string().trim().min(1, "Enter your agency's name.").max(120),
  defaultCountry: z.string().trim().min(1, "Choose a country.").max(8),
  defaultCurrency: z.string().trim().min(1, "Choose a currency.").max(8),
  timezone: z
    .string()
    .trim()
    .min(1, "Choose a timezone.")
    .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/, "Choose a timezone from the list."),
  defaultLanguage: z.enum(LANGUAGE_VALUES, { error: "Choose a language from the list." }),
});

/**
 * Step 3 — inviting a teammate. Administrator is deliberately not offered here:
 * handing out admin rights is a Team-screen decision, not a first-run shortcut.
 */
export const setupTeamInviteSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your team member's full name.").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." })),
  role: z.enum(["CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"], { error: "Choose a role." }),
});

export type AgencyBasicsInput = z.infer<typeof agencyBasicsSchema>;
export type SetupTeamInviteInput = z.infer<typeof setupTeamInviteSchema>;
