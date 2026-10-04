export interface RetentionSettings {
  bookingLinkedMessageRetentionYears?: number;
  enquiryMessageRetentionMonths?: number;
  inboxAttachmentRetentionDays?: number;
  voiceAudioRetentionDays?: number;
  intelligenceRetentionMonths?: number;
  aiRunRetentionMonths?: number;
  webhookPayloadRetentionDays?: number;
}

/** Finished queue rows (`channel_jobs`, `agent_jobs`) are kept this long for debugging, then deleted. Not agency-configurable: it is operational history, not customer data. */
export const FINISHED_JOB_RETENTION_DAYS = 30;
/** Only these are ever deleted: a queued, running or retrying job is live work. */
export const FINISHED_JOB_STATUSES = ["DONE", "DEAD"];

const clamp = (value: number | undefined, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, value ?? fallback));

export function resolveRetention(settings: RetentionSettings) {
  return {
    bookingLinkedMessageRetentionYears: clamp(settings.bookingLinkedMessageRetentionYears, 7, 3, 10),
    enquiryMessageRetentionMonths: clamp(settings.enquiryMessageRetentionMonths, 24, 1, 120),
    inboxAttachmentRetentionDays: clamp(settings.inboxAttachmentRetentionDays, 90, 1, 365),
    voiceAudioRetentionDays: clamp(settings.voiceAudioRetentionDays, 180, 1, 365),
    intelligenceRetentionMonths: clamp(settings.intelligenceRetentionMonths, 24, 1, 120),
    aiRunRetentionMonths: clamp(settings.aiRunRetentionMonths, 13, 1, 60),
    webhookPayloadRetentionDays: clamp(settings.webhookPayloadRetentionDays, 30, 1, 90),
  };
}

export function shouldDeleteConversationMessage(input: { lastActivityAt: Date; now: Date; linkedToBooking: boolean }, policy: ReturnType<typeof resolveRetention>): boolean {
  const ageDays = (input.now.getTime() - input.lastActivityAt.getTime()) / 86_400_000;
  const keepDays = input.linkedToBooking ? policy.bookingLinkedMessageRetentionYears * 365.25 : policy.enquiryMessageRetentionMonths * 30.4375;
  return ageDays > keepDays;
}
