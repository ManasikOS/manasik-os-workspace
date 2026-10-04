"use server";

import type {
  InboxConversationData,
  InboxConversationListPatch,
  InboxCustomerContext,
  InboxConversation,
  InboxHistoryRead,
  InboxListData,
  InboxNotesDelta,
  InboxPresenceRead,
  InboxThreadDelta,
} from "./types";
import {
  loadInboxConversationData,
  loadInboxConversationListPatch,
  loadInboxHistory,
  loadInboxIntelligence,
  loadInboxLeadContext,
  loadInboxListData,
  loadInboxNotesDelta,
  loadInboxPresence,
  loadInboxThreadDelta,
  searchInboxConversations,
} from "@/lib/data/inbox-repository";
import { requireUser } from "@/lib/dal";
import type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";
import { withTiming } from "@/lib/timing";
import {
  inboxConversationRequestSchema,
  inboxListPatchRequestSchema,
  inboxNotesDeltaRequestSchema,
  inboxSearchRequestSchema,
  inboxThreadDeltaRequestSchema,
  inboxWorkspaceRequestSchema,
} from "@/lib/validations/inbox";

/**
 * The Inbox dialog loads in three steps so each part can appear as soon as it
 * is ready: the chat list, then the open conversation, then the lead panel.
 */
export type InboxDialogLoadResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: string };

async function runInboxDialogLoad<TData>(
  actionName: string,
  load: () => Promise<TData | null>,
  failureMessage: string,
): Promise<InboxDialogLoadResult<TData>> {
  try {
    const data = await withTiming(`inbox.server-action.${actionName}`, load);
    if (!data) {
      return { ok: false, error: "You do not have access to the Inbox." };
    }
    return { ok: true, data };
  } catch (cause) {
    console.error(`${actionName} failed`, cause);
    return { ok: false, error: failureMessage };
  }
}

export async function loadInboxListAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxListData>> {
  await requireUser();
  const parsed = inboxWorkspaceRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The requested Inbox view is not valid." };
  }
  return runInboxDialogLoad(
    "loadInboxListAction",
    () => loadInboxListData(parsed.data),
    "The chat list could not be loaded. Please try again.",
  );
}

export async function loadInboxConversationAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxConversationData>> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That conversation could not be found." };
  }
  return runInboxDialogLoad(
    "loadInboxConversationAction",
    () => loadInboxConversationData(parsed.data.conversationId),
    "The messages could not be loaded. Please try again.",
  );
}

export async function loadInboxLeadContextAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxCustomerContext>> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That conversation could not be found." };
  }
  return runInboxDialogLoad(
    "loadInboxLeadContextAction",
    () => loadInboxLeadContext(parsed.data.conversationId),
    "The lead details could not be loaded. Please try again.",
  );
}

export async function loadInboxIntelligenceAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxIntelligenceData>> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That conversation could not be found." };
  }
  return runInboxDialogLoad(
    "loadInboxIntelligenceAction",
    () => loadInboxIntelligence(parsed.data.conversationId),
    "Copilot's reading could not be loaded. Please try again.",
  );
}

/* ── SC3: scoped reads for incremental synchronisation (docs/inbox/scaling.md §7) ───────────────────────────────────
 * Each starts with requireUser(), validates with Zod, and resolves the agency on the server. The full loaders above stay
 * the initial-load and reconciliation path; these read only what one realtime event says changed.
 */

export async function loadInboxConversationListPatchAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxConversationListPatch>> {
  await requireUser();
  const parsed = inboxListPatchRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The requested chat could not be found." };
  return runInboxDialogLoad(
    "loadInboxConversationListPatchAction",
    () => loadInboxConversationListPatch(parsed.data),
    "The chat could not be refreshed. Please try again.",
  );
}

export async function loadInboxThreadDeltaAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxThreadDelta>> {
  await requireUser();
  const parsed = inboxThreadDeltaRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  return runInboxDialogLoad(
    "loadInboxThreadDeltaAction",
    () => loadInboxThreadDelta(parsed.data),
    "The new messages could not be loaded. Please try again.",
  );
}

export async function loadInboxNotesDeltaAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxNotesDelta>> {
  await requireUser();
  const parsed = inboxNotesDeltaRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  return runInboxDialogLoad(
    "loadInboxNotesDeltaAction",
    () => loadInboxNotesDelta(parsed.data),
    "The notes could not be loaded. Please try again.",
  );
}

export async function loadInboxPresenceAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxPresenceRead>> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  return runInboxDialogLoad(
    "loadInboxPresenceAction",
    () => loadInboxPresence(parsed.data.conversationId),
    "Who is replying could not be loaded.",
  );
}

export async function loadInboxHistoryAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxHistoryRead>> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  return runInboxDialogLoad(
    "loadInboxHistoryAction",
    () => loadInboxHistory(parsed.data.conversationId),
    "The history could not be loaded.",
  );
}

export async function searchInboxConversationsAction(
  input: unknown,
): Promise<InboxDialogLoadResult<InboxConversation[]>> {
  await requireUser();
  const parsed = inboxSearchRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type a shorter search." };
  return runInboxDialogLoad(
    "searchInboxConversationsAction",
    () => searchInboxConversations(parsed.data.query),
    "The search could not be completed. Please try again.",
  );
}
