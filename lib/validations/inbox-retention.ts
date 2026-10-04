import { z } from "zod";

export const inboxRetentionSettingsSchema = z.object({
  bookingLinkedMessageRetentionYears: z.coerce.number().int().min(3).max(10),
  enquiryMessageRetentionMonths: z.coerce.number().int().min(1).max(120),
  inboxAttachmentRetentionDays: z.coerce.number().int().min(1).max(365),
  voiceAudioRetentionDays: z.coerce.number().int().min(1).max(365),
  intelligenceRetentionMonths: z.coerce.number().int().min(1).max(120),
  aiRunRetentionMonths: z.coerce.number().int().min(1).max(60),
  webhookPayloadRetentionDays: z.coerce.number().int().min(1).max(90),
}).strict();
