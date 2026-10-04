import { z } from "zod";

import { FOLLOW_UP_TYPES } from "@/lib/validations/leads";

import { queueCursorSchema, TIMESTAMP_PATTERN } from "@/lib/data/inbox-queue-repository";
import { conversionKindSchema } from "@/lib/inbox/conversions/catalogue";
import { INBOX_VIEWS } from "@/lib/inbox/views";

export const inboxWorkspaceRequestSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  view: z.enum(INBOX_VIEWS).default("all"),
  /** Keyset cursor for the next page of the view; omit for the first page. */
  cursor: queueCursorSchema.nullable().optional(),
});

export type InboxWorkspaceRequest = z.infer<
  typeof inboxWorkspaceRequestSchema
>;


export const inboxConversationRequestSchema = z.object({
  conversationId: z.string().uuid(),
});

/** Email-only fields (docs/inbox/email-channel-implementation-plan.md, Phase 3): absent on every other channel. */
const emailAddressListSchema = z.array(z.string().trim().email()).max(20);
const emailSubjectSchema = z.string().trim().max(300);
const emailFieldsSchema = {
  subject: emailSubjectSchema.optional(),
  cc: emailAddressListSchema.optional(),
  bcc: emailAddressListSchema.optional(),
};

export const inboxStaffMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Message is empty.").max(10_000, "Messages must be 10,000 characters or fewer."),
  /**
   * The browser's key for THIS send attempt. A network retry reuses it, so the database returns the message it already
   * stored instead of creating a second one; a new deliberate send (even with identical text) gets a new key.
   */
  clientIdempotencyKey: z.string().uuid().optional(),
  ...emailFieldsSchema,
}).strict();

/** A message that carries a file: the text is an optional caption, so it may be empty. */
export const inboxStaffCaptionSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().max(1_000, "A caption can be up to 1,000 characters."),
  clientIdempotencyKey: z.string().uuid().optional(),
  ...emailFieldsSchema,
}).strict();

/** Starts a brand-new email conversation (staff can start one, unlike Messenger/Instagram). */
export const inboxComposeEmailSchema = z.object({
  recipientEmail: z.string().trim().email("Enter a valid email address."),
  subject: emailSubjectSchema.min(1, "Give the email a subject."),
  body: z.string().trim().min(1, "Message is empty.").max(10_000, "Messages must be 10,000 characters or fewer."),
  cc: emailAddressListSchema.optional(),
  bcc: emailAddressListSchema.optional(),
}).strict();
export type InboxComposeEmailInput = z.infer<typeof inboxComposeEmailSchema>;

export const createSavedReplyInputSchema = z.object({
  title: z.string().trim().min(1, "Give the reply a title.").max(120, "Titles are shorter than that."),
  body: z.string().trim().min(1, "The reply text is empty.").max(4_000, "Saved replies can be up to 4,000 characters."),
  isPrivate: z.boolean().default(false),
});
export type CreateSavedReplyInput = z.infer<typeof createSavedReplyInputSchema>;

export const inboxTemplateMessageSchema = z.object({
  conversationId: z.string().uuid(),
  templateId: z.string().uuid(),
  bodyParameters: z.array(z.string().trim().max(1000)).max(20),
}).strict();

export type InboxConversationRequest = z.infer<
  typeof inboxConversationRequestSchema
>;

export const inboxHandoffAcknowledgementSchema = z.object({ handoffId: z.string().uuid() });

/** An action on the offer card. The browser names the conversation (and, to open one, which listed departure); the offer itself is always re-read on the server. */
export const inboxOfferRequestSchema = z.object({
  conversationId: z.string().uuid(),
  departureGroupId: z.string().uuid().optional(),
});
export type InboxOfferRequest = z.infer<typeof inboxOfferRequestSchema>;

export const inboxOfferMessageRequestSchema = z.object({
  conversationId: z.string().uuid(),
  kind: z.enum(["REPLY", "FOLLOW_UP"]),
});
export type InboxOfferMessageRequest = z.infer<typeof inboxOfferMessageRequestSchema>;

/** A decision on a review card. Closing one is a decision someone answers for, so resolving or dismissing needs a note. */
export const inboxInterventionDecisionSchema = z
  .object({
    conversationId: z.string().uuid(),
    interventionId: z.string().uuid(),
    decision: z.enum(["ACKNOWLEDGE", "RESOLVE", "DISMISS"]),
    note: z.string().trim().max(1000).default(""),
  })
  .refine((value) => value.decision === "ACKNOWLEDGE" || value.note.length > 0, { message: "Write a short note before you close this review.", path: ["note"] });
export type InboxInterventionDecision = z.infer<typeof inboxInterventionDecisionSchema>;

/** A decision on a suggested identity match. The browser names the conversation and the suggestion; the server checks they belong together. */
export const inboxIdentityLinkRequestSchema = z.object({
  conversationId: z.string().uuid(),
  linkId: z.string().uuid(),
});
export type InboxIdentityLinkRequest = z.infer<typeof inboxIdentityLinkRequestSchema>;

/** Ask what a conversation would create (MI4.6). The browser names the conversation, the kind and an optional note — nothing else. */
export const inboxConversionPreviewSchema = z.object({
  conversationId: z.string().uuid(),
  kind: conversionKindSchema,
  note: z.string().trim().max(300, "Keep the note under 300 characters.").default(""),
  /** What the person chose, for a conversion that asks for a decision. Each value is checked against what the server offered. */
  params: z.record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

/** Ask what the person can choose for one conversion (MI4.6). */
export const inboxConversionChoicesSchema = z.object({ conversationId: z.string().uuid(), kind: conversionKindSchema });

/** Confirm or cancel a request the server already wrote (MI4.6). */
export const inboxConversionDecisionSchema = z.object({ proposalId: z.string().uuid() });

/** A bare identifier from the browser (a conversation, a departure group). Anything that is not a UUID is rejected before it reaches a query. */
export const inboxEntityIdSchema = z.string().uuid();

/** Staff-typed text that starts a WhatsApp chat: every field is bounded because the browser is not a trust boundary. */
export const inboxStartChatSchema = z.object({
  phoneNumber: z.string().max(32),
  contactName: z.string().trim().max(120).optional(),
  templateId: z.string().uuid("Choose an approved message template."),
  bodyParameters: z.array(z.string().trim().max(1000)).max(20),
}).strict();

/** An internal note: bounded body and a capped list of mentioned staff ids. */
export const inboxInternalNoteSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Note is empty.").max(10_000, "Notes must be 10,000 characters or fewer."),
  mentionedUserIds: z.array(z.string().uuid()).max(20, "A note can mention up to 20 staff members.").default([]),
}).strict();

/** SC3 — scoped reads. Each names one conversation and only what the browser already knows about it. */
export const inboxListPatchRequestSchema = z.object({
  conversationId: z.string().uuid(),
  view: z.enum(INBOX_VIEWS).default("all"),
  /** Asked for only when the event reason can change counts; otherwise the rail keeps the counts it has. */
  includeCounts: z.boolean().default(false),
}).strict();
export type InboxListPatchRequest = z.infer<typeof inboxListPatchRequestSchema>;

/** Messages after the sequence the browser last applied, plus specific ids whose delivery state changed. */
export const inboxThreadDeltaRequestSchema = z.object({
  conversationId: z.string().uuid(),
  afterSequence: z.number().int().min(0),
  messageIds: z.array(z.string().uuid()).max(50).default([]),
}).strict();
export type InboxThreadDeltaRequest = z.infer<typeof inboxThreadDeltaRequestSchema>;

/** Notes after the last (created_at, id) the browser holds, plus ids whose note changed or was deleted. */
export const inboxNotesDeltaRequestSchema = z.object({
  conversationId: z.string().uuid(),
  after: z.object({ createdAt: z.string().regex(TIMESTAMP_PATTERN, "Not a timestamp"), id: z.string().uuid() }).nullable().default(null),
  noteIds: z.array(z.string().uuid()).max(50).default([]),
}).strict();
export type InboxNotesDeltaRequest = z.infer<typeof inboxNotesDeltaRequestSchema>;

/** Schedule a follow-up from an open chat. */
export const inboxFollowUpRequestSchema = z.object({
  conversationId: z.string().uuid(),
  dueAt: z.string().min(1).max(64),
  type: z.enum(FOLLOW_UP_TYPES),
}).strict();

/** Give a conversation to a person, or take its owner off it (`assigneeId: null`). */
export const inboxAssignConversationSchema = z.object({
  conversationId: z.string().uuid(),
  assigneeId: z.string().uuid().nullable(),
}).strict();

/** The text typed in the Inbox search box. It is normalised again on the server before it reaches a filter. */
export const inboxSearchRequestSchema = z.object({
  query: z.string().max(200),
}).strict();

/** A change to several conversations at once. The list is capped so one request stays small. */
export const inboxBulkUpdateSchema = z.object({
  conversationIds: z.array(z.string().uuid()).min(1).max(50),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ASSIGN"), assigneeId: z.string().uuid().nullable() }),
    z.object({ kind: z.literal("CLOSE") }).strict(),
    z.object({ kind: z.literal("MARK_SPAM") }).strict(),
    z.object({ kind: z.literal("UNMARK_SPAM") }).strict(),
  ]),
}).strict();
