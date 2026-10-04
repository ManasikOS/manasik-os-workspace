import { z } from "zod";

/**
 * Settings for automatic follow-ups and unanswered-handoff alerts (ai_settings columns added in
 * supabase/migrations/20261201090000_lead_retention_followups.sql). The nudge text is shown to
 * customers, so it is length-capped and stripped of control characters.
 */

export const FOLLOWUP_MAX_DELAYS = 3;
export const FOLLOWUP_MAX_DELAY_HOURS = 720;
export const FOLLOWUP_MESSAGE_MAX_CHARS = 500;
export const HANDOFF_ALERT_MAX_MINUTES = 1440;
export const HANDOFF_ESCALATION_MAX_MINUTES = 10080;

/** Removes control characters (keeps newlines) and trims. */
export function cleanFollowupText(value: string): string {
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim();
}

export const followupSettingsSchema = z
  .object({
    followupsEnabled: z.boolean(),
    followupsDryRun: z.boolean(),
    followupDelaysHours: z
      .array(z.number().int("Delays must be whole hours.").min(1, "Each delay must be at least 1 hour.").max(FOLLOWUP_MAX_DELAY_HOURS, "Each delay can be at most 720 hours (30 days)."))
      .min(1, "Add at least one follow-up delay.")
      .max(FOLLOWUP_MAX_DELAYS, "You can set up to 3 follow-ups."),
    followupMessageText: z
      .string()
      .transform(cleanFollowupText)
      .pipe(z.string().min(1, "Write the follow-up message.").max(FOLLOWUP_MESSAGE_MAX_CHARS, "The follow-up message can be at most 500 characters.")),
    followupWhatsappTemplateId: z.string().uuid().nullable(),
    handoffAlertMinutes: z.number().int().min(1, "Alert time must be at least 1 minute.").max(HANDOFF_ALERT_MAX_MINUTES, "Alert time can be at most 1440 minutes (24 hours)."),
    handoffEscalationMinutes: z.number().int().min(1).max(HANDOFF_ESCALATION_MAX_MINUTES, "Escalation time can be at most 10080 minutes (7 days)."),
  })
  .superRefine((value, context) => {
    for (let index = 1; index < value.followupDelaysHours.length; index += 1) {
      if (value.followupDelaysHours[index] <= value.followupDelaysHours[index - 1]) {
        context.addIssue({ code: "custom", path: ["followupDelaysHours"], message: "Each follow-up must come later than the one before it." });
        break;
      }
    }
    if (value.handoffEscalationMinutes < value.handoffAlertMinutes) {
      context.addIssue({ code: "custom", path: ["handoffEscalationMinutes"], message: "The escalation time must not be shorter than the alert time." });
    }
  });

export type FollowupSettingsInput = z.infer<typeof followupSettingsSchema>;
