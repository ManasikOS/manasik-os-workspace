"use client";

import { format } from "date-fns";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  CheckCheck,
  ArrowDown,
  CircleAlert,
  Clock3,
  Mail,
  Sparkles,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { COPILOT_NAME } from "@/lib/agent/identity";
import type { InboxCapabilities } from "@/lib/access/inbox-access";
import {
  channelDisplayName,
  composerStateFor,
} from "@/lib/inbox/composer-state";
import { emailMetadataOf } from "@/lib/inbox/email-message-metadata";
import {
  buildPendingStaffMessage,
  dismissPendingMessage,
  markPendingAccepted,
  markPendingFailed,
  markPendingRetrying,
  retryRequestFor,
  settlePendingMessages,
  type PendingSendStart,
  type PendingStaffMessage,
} from "@/lib/inbox/pending-messages";
import { runPendingSend } from "@/lib/inbox/pending-send";
import { cn } from "@/lib/utils";
import {
  contactAvatarColorClasses,
  contactAvatarInitials,
} from "@/lib/inbox/contact-avatar-color";

import MessageComposer from "./message-composer";
import { sendStaffMessage } from "../actions";
import { useInboxScopedSync } from "./inbox-refresh-context";
import ConversationActionsMenu from "./conversation-actions-menu";
import { ConversationOwnershipBadges } from "./conversation-ownership-badges";
import { ConversationOwnerSelect } from "./conversation-owner-select";
import { ConversationThreadSkeleton } from "./inbox-section-skeletons";
import type {
  InboxAttachment,
  InboxConversation,
  InboxMentionableStaff,
  InboxMediaAnalysis,
  InboxMessage,
  InboxNote,
  InboxSavedReply,
  InboxTemplate,
} from "../types";
import { containsArabicScript } from "@/lib/inbox/arabic-script";
import { Card } from "@/components/ui/card";
import type { ComposerPresence } from "@/lib/inbox/composer-presence";
import type { NextBestAction } from "@/lib/inbox/next-best-action";
import { replyOwnershipNoticeFor } from "@/lib/inbox/reply-ownership-notice";
import { ChannelPolicyBanner } from "./channel-policy-banner";
import {
  isReviewableMediaAnalysis,
  isRoutableMediaAnalysis,
  MessageMediaReviews,
} from "./message-media-reviews";
import {
  decideThreadScroll,
  isThreadNearBottom,
} from "@/lib/inbox/thread-scroll";
import { threadDayKey, threadDayLabel } from "@/lib/inbox/thread-day-label";
import { groupThreadMessages } from "@/lib/inbox/group-thread-messages";
import { InboxMessageMedia } from "./inbox-message-media";
import { VoiceTranscriptPanel } from "./voice-transcript-panel";
import { InboxConversationTemplatePicker } from "./template-picker-sheet";
import type { DeliveryStatus } from "@/lib/types/whatsapp";
import Instagram from "@/public/source_logos/instagram.svg";
import WhatsApp from "@/public/source_logos/whatsapp.svg";
import Messenger from "@/public/source_logos/messenger.svg";
import Image from "next/image";
/** A media-only message has no text worth showing; the stored voice placeholder is for the assistant, not for staff. */
function visibleMessageText(content: string, hasMedia: boolean): boolean {
  if (!content.trim()) return false;
  return !(hasMedia && content.startsWith("[Voice message"));
}

const ROLE_STYLE: Record<InboxMessage["role"], string> = {
  user: "  self-start",
  // Copilot's replies are outlined, not filled, so they never read as something a colleague typed.
  assistant: "bg-muted! text-foreground border self-end",
  staff:
    "bg-primary/10! shadow-primary/10 shadow-xs! border-none  text-primary! self-end",
  system:
    "bg-transparent border border-dashed text-muted-foreground self-center text-xs italic",
  tool: "hidden",
};

/**
 * Re-evaluated every minute so a reply window that closes while the conversation is open is shown as closed. `refreshKey` also refreshes it
 * the moment something time-stamped arrives (a colleague starting to write): a clock older than that stamp would read it as "in the future"
 * and hide the warning until the next minute.
 */
function useMinuteClock(refreshKey: string | null): Date {
  const [now, setNow] = useState(() => new Date());
  const [seenKey, setSeenKey] = useState(refreshKey);
  if (seenKey !== refreshKey) {
    setSeenKey(refreshKey);
    setNow(new Date());
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const ACTOR_LABEL: Record<InboxMessage["actor_kind"], string> = {
  CUSTOMER: "",
  AI: COPILOT_NAME,
  STAFF: "Staff",
  SYSTEM: "System",
};

const DELIVERY_STATUS_PRESENTATION: Record<
  DeliveryStatus,
  { label: string; icon: typeof Clock3; className?: string }
> = {
  PENDING: { label: "Sending…", icon: Clock3 },
  SENT: { label: "Sent", icon: Check },
  DELIVERED: { label: "Delivered", icon: CheckCheck },
  READ: { label: "Read", icon: CheckCheck, className: "text-primary" },
  FAILED: {
    label: "Failed",
    icon: CircleAlert,
    className: "text-destructive",
  },
};

function InboxMessageDeliveryStatus({ status }: { status: DeliveryStatus }) {
  const presentation = DELIVERY_STATUS_PRESENTATION[status];
  const DeliveryIcon = presentation.icon;

  return (
    <span
      className={cn("inline-flex items-center gap-1", presentation.className)}
    >
      <DeliveryIcon className="size-3" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

export default function ConversationPanel({
  conversation,
  messages,
  attachments,
  mediaAnalyses,
  notes,
  savedReplies,
  templates,
  mentionableStaff,
  draft,
  composerPresence,
  composerStaffId,
  capabilities,
  canUseCopilot,
  nextAction = null,
  leadPanelToggle,
  isLoading = false,
  loadError = null,
  onRetryLoad,
}: {
  conversation: InboxConversation;
  messages: InboxMessage[];
  attachments: InboxAttachment[];
  mediaAnalyses: InboxMediaAnalysis[];
  notes: InboxNote[];
  savedReplies: InboxSavedReply[];
  templates: InboxTemplate[];
  mentionableStaff: InboxMentionableStaff[];
  draft: string;
  composerPresence: ComposerPresence | null;
  composerStaffId: string | null;
  capabilities: InboxCapabilities;
  canUseCopilot: boolean;
  /** What Copilot suggests doing next; the composer gives it the prominent button. */
  nextAction?: NextBestAction | null;
  leadPanelToggle?: ReactNode;
  /** The messages are still loading; the header is already real. */
  isLoading?: boolean;
  loadError?: string | null;
  onRetryLoad?: () => void;
}) {
  // Messages sent from this panel that the server has not shown back yet: shown at once as "Sending…".
  const [pending, setPending] = useState<PendingStaffMessage[]>([]);
  // Derived while rendering: a pending message disappears the moment the refreshed thread contains it.
  const pendingHere = useMemo(
    () =>
      settlePendingMessages(pending, messages).filter(
        (entry) => entry.conversationId === conversation.id,
      ),
    [conversation.id, messages, pending],
  );
  const timeline = useMemo(
    () =>
      [
        ...messages.map((message) => ({
          kind: "message" as const,
          item: message,
        })),
        ...notes.map((note) => ({ kind: "note" as const, item: note })),
      ].sort(
        (a, b) =>
          new Date(a.item.created_at).getTime() -
          new Date(b.item.created_at).getTime(),
      ),
    [messages, notes],
  );
  const attachmentsByMessage = useMemo(() => {
    const grouped = new Map<string, InboxAttachment[]>();
    for (const attachment of attachments)
      grouped.set(attachment.message_id, [
        ...(grouped.get(attachment.message_id) ?? []),
        attachment,
      ]);
    return grouped;
  }, [attachments]);
  // The reply's starting subject: "Re: " plus the last inbound email's subject, so a Gmail-like thread stays
  // recognisable in the customer's own mail client even though this Inbox groups it by contact (D2).
  const defaultReplySubject = useMemo(() => {
    if (conversation.channel !== "GMAIL") return null;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== "user") continue;
      const subject = emailMetadataOf(message.metadata).subject;
      if (subject)
        return subject.toLowerCase().startsWith("re:")
          ? subject
          : `Re: ${subject}`;
    }
    return null;
  }, [conversation.channel, messages]);
  // Each row knows whether it starts a new day, so the thread can say "Today" / "Yesterday" / a date above it.
  const threadRows = useMemo(() => {
    const today = new Date();
    const dated = timeline.map((entry, index) => {
      const createdAt = new Date(entry.item.created_at);
      const previous =
        index > 0 ? new Date(timeline[index - 1].item.created_at) : null;
      return {
        entry,
        createdAt,
        startsNewDay:
          previous === null ||
          threadDayKey(previous) !== threadDayKey(createdAt),
      };
    });
    // Neighbouring messages from one sender share a single "who and when" line, printed under the last bubble.
    const placements = groupThreadMessages(
      dated.map(({ entry, createdAt, startsNewDay }) => ({
        kind: entry.kind,
        senderKey:
          entry.kind === "message"
            ? `${entry.item.role}:${entry.item.actor_kind}`
            : "note",
        createdAt,
        failed:
          entry.kind === "message" && entry.item.delivery_status === "FAILED",
        startsNewDay,
      })),
    );
    return dated.map(({ entry, createdAt, startsNewDay }, index) => ({
      entry,
      dayLabel: startsNewDay ? threadDayLabel(createdAt, today) : null,
      placement: placements[index],
    }));
  }, [timeline]);
  // Review and routing cards sit under the message that carried the file. One whose message is not in the loaded thread
  // (an older page) is still reachable at the end, so it is never lost.
  const { analysesByMessage, unplacedAnalyses } = useMemo(() => {
    const messageIds = new Set(messages.map((message) => message.id));
    const byMessage = new Map<string, InboxMediaAnalysis[]>();
    const unplaced: InboxMediaAnalysis[] = [];
    for (const analysis of mediaAnalyses) {
      if (
        !isReviewableMediaAnalysis(analysis) &&
        !isRoutableMediaAnalysis(analysis)
      )
        continue;
      if (messageIds.has(analysis.message_id)) {
        byMessage.set(analysis.message_id, [
          ...(byMessage.get(analysis.message_id) ?? []),
          analysis,
        ]);
      } else {
        unplaced.push(analysis);
      }
    }
    return { analysesByMessage: byMessage, unplacedAnalyses: unplaced };
  }, [mediaAnalyses, messages]);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const newestMessage = messages.at(-1) ?? null;
  const newestMessageId = newestMessage?.id ?? null;
  const newestPendingId = pendingHere.at(-1)?.id ?? null;
  const scrolledConversationIdRef = useRef<string | null>(null);
  const lastSeenNewestRef = useRef<{
    message: string | null;
    pending: string | null;
  }>({ message: null, pending: null });
  // Whether the person is reading at the bottom, kept from their scrolling so a message arriving never has to guess.
  const nearBottomRef = useRef(true);
  // Customer messages that arrived while the person was reading further up.
  const [unseenCount, setUnseenCount] = useState(0);

  const scrollThreadToBottom = useCallback((behavior: ScrollBehavior) => {
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const handleThreadScroll = useCallback(() => {
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    nearBottomRef.current = isThreadNearBottom(viewport);
    if (nearBottomRef.current) setUnseenCount(0);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const viewport = threadViewportRef.current;
    if (!viewport) return;

    const switchedConversation =
      scrolledConversationIdRef.current !== conversation.id;
    scrolledConversationIdRef.current = conversation.id;
    const previous = lastSeenNewestRef.current;
    lastSeenNewestRef.current = {
      message: newestMessageId,
      pending: newestPendingId,
    };
    const ownSend =
      newestPendingId !== previous.pending && newestPendingId !== null;
    const customerMessage =
      newestMessageId !== previous.message &&
      newestMessage !== null &&
      newestMessage.role === "user";
    const decision = decideThreadScroll({
      switchedConversation,
      newItemArrived:
        newestMessageId !== previous.message ||
        newestPendingId !== previous.pending,
      ownSend:
        ownSend ||
        (newestMessageId !== previous.message &&
          newestMessage?.role !== "user"),
      wasNearBottom: nearBottomRef.current,
    });
    if (decision === "NONE") return;
    if (decision === "NOTIFY") {
      if (customerMessage) setUnseenCount((count) => count + 1);
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const frame = window.requestAnimationFrame(() => {
      scrollThreadToBottom(
        decision === "JUMP" || prefersReducedMotion ? "auto" : "smooth",
      );
      nearBottomRef.current = true;
      setUnseenCount(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    conversation.id,
    isLoading,
    newestMessage,
    newestMessageId,
    newestPendingId,
    scrollThreadToBottom,
  ]);

  // The pending message's id IS the send attempt's idempotency key (generated by the composer), so the canonical
  // message settles it by exact key and a retry reuses the key.
  const { syncThread } = useInboxScopedSync();
  const startPending = useCallback(
    (send: PendingSendStart) => {
      setPending((current) => [
        ...settlePendingMessages(current, messages),
        buildPendingStaffMessage({
          ...send,
          conversationId: conversation.id,
          now: new Date(),
        }),
      ]);
    },
    [conversation.id, messages],
  );
  const acceptPending = useCallback((key: string) => {
    setPending((current) => markPendingAccepted(current, key));
  }, []);
  const failPending = useCallback((key: string, error: string) => {
    setPending((current) => markPendingFailed(current, key, error));
  }, []);
  const dismissPending = useCallback((key: string) => {
    setPending((current) => dismissPendingMessage(current, key));
  }, []);
  const retryPending = useCallback(
    (entry: PendingStaffMessage) => {
      setPending((current) => markPendingRetrying(current, entry.id));
      // The SAME key, text and file: if the first try did commit, the server returns that message instead of creating another.
      const request = retryRequestFor(entry);
      void runPendingSend({
        key: request.key,
        send: () =>
          sendStaffMessage(
            request.conversationId,
            request.body,
            request.proposalId,
            request.key,
            request.attachment,
          ),
        onAccepted: acceptPending,
        onFailed: failPending,
        syncThread,
      });
    },
    [acceptPending, failPending, syncThread],
  );

  // Sending a reply takes control from the assistant automatically (see sendStaffMessage), so what blocks the
  // composer is a closed conversation, a missing permission, or — on Messenger and Instagram — Meta's rule that
  // the customer writes first and that a reply must come within 24 hours (lib/inbox/composer-state.ts).
  const now = useMinuteClock(composerPresence?.at ?? null);
  const composer = composerStateFor({
    conversationState: conversation.state,
    canSendMessage: capabilities.sendMessage,
    channel: conversation.channel,
    serviceWindowExpiresAt: conversation.service_window_expires_at,
    humanAgentWindowExpiresAt:
      conversation.human_agent_window_expires_at ?? null,
    hasOpenSupportCase: conversation.has_open_support_case,
    now,
  });
  const composerEnabled = composer.canReply;
  const disabledReason = composer.canReply ? "" : composer.notice;

  return (
    <div
      className="flex h-full min-w-0 w-full  flex-col"
      data-inbox-conversation-open=""
    >
      <header className="flex flex-row items-center justify-between gap-x-3 gap-y-2 border-b border-muted px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative w-fit h-fit">
            <Avatar className="size-10 border">
              <AvatarFallback
                className={cn(
                  "text-xs font-medium",
                  contactAvatarColorClasses(
                    conversation.contact_name || conversation.contact_phone,
                  ),
                )}
              >
                {contactAvatarInitials(
                  conversation.contact_name,
                  conversation.contact_phone,
                )}
              </AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0">
              {channelDisplayName(conversation.channel) === "WhatsApp" && (
                <Image src={WhatsApp} width={15} height={15} alt="WhatsApp" />
              )}
              {channelDisplayName(conversation.channel) === "Instagram" && (
                <Image src={Instagram} width={15} height={15} alt="Instagram" />
              )}
              {channelDisplayName(conversation.channel) === "Messenger" && (
                <Image src={Messenger} width={15} height={15} alt="Messenger" />
              )}
              {conversation.channel === "GMAIL" && (
                <span
                  className="flex size-3.75 items-center justify-center rounded-full bg-background text-muted-foreground"
                  aria-label="Email"
                >
                  <Mail className="size-2.5" aria-hidden="true" />
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate text-base font-semibold tracking-tight",
                containsArabicScript(
                  conversation.contact_name || conversation.contact_phone || "",
                ) && "font-arabic",
              )}
            >
              {conversation.contact_name || conversation.contact_phone}
            </h2>
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {conversation.contact_phone
                ? conversation.contact_phone
                : conversation.channel === "WHATSAPP"
                  ? ""
                  : conversation.channel === "GMAIL"
                    ? conversation.external_conversation_id
                    : "No phone yet"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ConversationOwnershipBadges
            state={conversation.state}
            assignedToName={conversation.assigned_to_name}
            assignedToId={conversation.assigned_to_id}
            currentStaffId={composerStaffId}
            ownerControl={
              capabilities.assignConversation &&
              mentionableStaff.length > 0 &&
              conversation.state !== "CLOSED" ? (
                <ConversationOwnerSelect
                  conversationId={conversation.id}
                  assignedToId={conversation.assigned_to_id}
                  assignedToName={conversation.assigned_to_name}
                  staff={mentionableStaff}
                  currentStaffId={composerStaffId}
                />
              ) : null
            }
          />
          <ConversationActionsMenu
            conversation={conversation}
            capabilities={capabilities}
          />
          {leadPanelToggle}
        </div>
      </header>

      {isLoading || loadError ? (
        loadError ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <p className="text-sm text-muted-foreground">{loadError}</p>
            {onRetryLoad && (
              <Button
                variant="outline_without_border"
                size="sm"
                onClick={onRetryLoad}
              >
                Try again
              </Button>
            )}
          </div>
        ) : (
          <ConversationThreadSkeleton />
        )
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={threadViewportRef}
              role="log"
              aria-label="Conversation messages"
              aria-live="polite"
              onScroll={handleThreadScroll}
              className="flex flex-1 animate-in flex-col overflow-y-auto fade-in-0 duration-200 custom-scroll bg-muted/[0.14] px-3 py-5 sm:px-5"
            >
              {threadRows.map(({ entry, dayLabel, placement }) => (
                <Fragment key={entry.item.id}>
                  {dayLabel && (
                    <div className="my-4 flex items-center gap-3 text-xs font-medium text-muted-foreground first:mt-0">
                      <span
                        className="h-px flex-1 bg-border"
                        aria-hidden="true"
                      />
                      {dayLabel}
                      <span
                        className="h-px flex-1 bg-border"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                  {entry.kind === "note" ? (
                    <div className="my-3 w-full max-w-md self-center rounded-xl border border-dashed bg-background/80 px-3 py-2 text-sm shadow-sm">
                      <div className="mb-0.5 text-xs text-muted-foreground">
                        Internal note · {entry.item.author_name_snapshot} ·{" "}
                        {format(new Date(entry.item.created_at), "HH:mm")}
                      </div>
                      <p className="whitespace-pre-wrap wrap-break-word">
                        {entry.item.body}
                      </p>
                    </div>
                  ) : (
                    <div
                      id={`inbox-message-${entry.item.id}`}
                      className={cn(
                        "flex w-full flex-col gap-1",
                        placement.startsGroup && !dayLabel ? "mt-4" : "mt-1",
                        (entry.item.role === "staff" ||
                          entry.item.role === "assistant") &&
                          "items-end",
                        entry.item.role === "user" && "items-start",
                        entry.item.id === newestMessageId &&
                          entry.item.role === "user" &&
                          "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none",
                      )}
                    >
                      <Card
                        variant="md-shadow"
                        title={format(new Date(entry.item.created_at), "HH:mm")}
                        className={cn(
                          "flex max-w-[88%] flex-col gap-1 rounded-sm p-0 sm:max-w-[76%]",
                          ROLE_STYLE[entry.item.role],
                          entry.item.role === "user" &&
                            "rounded-tl-none bg-background",
                          (entry.item.role === "assistant" ||
                            entry.item.role === "staff") &&
                            "rounded-tr-none",
                        )}
                      >
                        {conversation.channel === "GMAIL" &&
                          emailMetadataOf(entry.item.metadata).subject && (
                            <p className="truncate px-3.5 pt-2 text-xs font-medium text-muted-foreground">
                              {emailMetadataOf(entry.item.metadata).subject}
                            </p>
                          )}
                        <InboxMessageMedia
                          attachments={
                            attachmentsByMessage.get(entry.item.id) ?? []
                          }
                        />
                        {visibleMessageText(
                          entry.item.content,
                          attachmentsByMessage.has(entry.item.id),
                        ) && (
                          <p
                            className={cn(
                              "whitespace-pre-wrap wrap-break-word text-sm  px-3.5 py-1.5 leading-relaxed",
                              entry.item.role === "staff" && "text-primary",
                            )}
                          >
                            {entry.item.content}
                          </p>
                        )}
                      </Card>
                      {mediaAnalyses
                        .filter(
                          (analysis) =>
                            analysis.message_id === entry.item.id &&
                            analysis.voice_transcript,
                        )
                        .map((analysis) => (
                          <VoiceTranscriptPanel
                            key={analysis.id}
                            transcript={analysis.voice_transcript!}
                          />
                        ))}
                      <MessageMediaReviews
                        analyses={analysesByMessage.get(entry.item.id) ?? []}
                        conversationId={conversation.id}
                        capabilities={capabilities}
                      />
                      {/* Inside a burst the sender and time are said once, under the last bubble; the time stays on hover and for screen readers. */}
                      {!placement.showMeta && (
                        <span className="sr-only">
                          {ACTOR_LABEL[entry.item.actor_kind]},{" "}
                          {format(new Date(entry.item.created_at), "HH:mm")}
                        </span>
                      )}
                      {placement.showMeta && (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {entry.item.actor_kind === "AI" && (
                              <Sparkles className="size-3" aria-hidden="true" />
                            )}
                            {ACTOR_LABEL[entry.item.actor_kind]}
                          </span>
                          <span>
                            {format(new Date(entry.item.created_at), "HH:mm")}
                          </span>
                          {(entry.item.role === "staff" ||
                            entry.item.role === "assistant") && (
                            <InboxMessageDeliveryStatus
                              status={entry.item.delivery_status}
                            />
                          )}
                        </div>
                      )}
                      {/* {entry.item.role === "user" && (
                        <InboxTranslationControl
                          conversationId={conversation.id}
                          messageId={entry.item.id}
                        />
                      )} */}
                      {/* A staff or assistant message the channel refused must not look sent. */}
                      {entry.item.delivery_status === "FAILED" &&
                        (entry.item.role === "staff" ||
                          entry.item.role === "assistant") && (
                          <p role="alert" className="text-xs text-destructive">
                            Not delivered
                            {entry.item.delivery_error
                              ? `: ${entry.item.delivery_error}`
                              : ". The customer did not receive this message."}
                          </p>
                        )}
                    </div>
                  )}
                </Fragment>
              ))}
              {pendingHere.map((entry) => (
                <div
                  key={entry.id}
                  className="mt-2 flex w-full animate-in flex-col items-end gap-1 fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                >
                  <Card
                    className={cn(
                      "flex max-w-[88%] flex-col gap-1 rounded-sm px-3.5 py-1.5 sm:max-w-[76%]",
                      ROLE_STYLE.staff,
                      entry.status !== "FAILED" && "opacity-80",
                    )}
                  >
                    <p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-primary">
                      {entry.content}
                    </p>
                  </Card>
                  <div
                    aria-live="polite"
                    className={cn(
                      "flex items-center gap-2 text-xs text-muted-foreground",
                      entry.status === "FAILED" && "text-destructive",
                    )}
                  >
                    <span>{ACTOR_LABEL.STAFF}</span>
                    <span className="inline-flex items-center gap-1">
                      {entry.status !== "FAILED" ? (
                        <Clock3 className="size-3" aria-hidden="true" />
                      ) : (
                        <CircleAlert className="size-3" aria-hidden="true" />
                      )}
                      {entry.status !== "FAILED" ? "Sending…" : "Not sent"}
                    </span>
                  </div>
                  {entry.status === "FAILED" && (
                    <p className="text-xs text-destructive">
                      {entry.error ?? "This message could not be sent."}{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => retryPending(entry)}
                      >
                        Retry
                      </button>{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => dismissPending(entry.id)}
                      >
                        Dismiss
                      </button>
                    </p>
                  )}
                </div>
              ))}
              {unplacedAnalyses.length > 0 && (
                <MessageMediaReviews
                  analyses={unplacedAnalyses}
                  conversationId={conversation.id}
                  capabilities={capabilities}
                />
              )}
              {messages.length === 0 &&
                notes.length === 0 &&
                pendingHere.length === 0 && (
                  <div className="m-auto flex max-w-xs flex-col items-center gap-2 text-center">
                    <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="size-4" />
                    </span>
                    <p className="text-sm font-medium">A new conversation</p>
                    <p className="text-xs text-muted-foreground">
                      Messages and internal notes will appear here.
                    </p>
                  </div>
                )}
            </div>
            {unseenCount > 0 && (
              <Button
                type="button"
                size="sm"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
                onClick={() => {
                  scrollThreadToBottom("smooth");
                  setUnseenCount(0);
                }}
              >
                <ArrowDown aria-hidden="true" />
                {unseenCount === 1
                  ? "1 new message"
                  : `${unseenCount} new messages`}
              </Button>
            )}
          </div>

          {composer.policy && (
            <div className="px-1 pt-3">
              <ChannelPolicyBanner
                state={composer.policy}
                channel={conversation.channel}
                serviceWindowExpiresAt={conversation.service_window_expires_at}
                humanAgentWindowExpiresAt={
                  conversation.human_agent_window_expires_at ?? null
                }
                now={now}
                conversationId={conversation.id}
                canDraft={canUseCopilot && composerEnabled}
                actionWidget={
                  composer.policy.action === "APPROVED_TEMPLATE" && (
                    <div className="mt-2">
                      <InboxConversationTemplatePicker
                        conversationId={conversation.id}
                        templates={templates}
                      />
                    </div>
                  )
                }
              />
            </div>
          )}
          <MessageComposer
            key={conversation.id}
            conversationId={conversation.id}
            channel={conversation.channel}
            defaultSubject={defaultReplySubject}
            enabled={composerEnabled}
            canCollaborate={capabilities.sendMessage}
            disabledReason={disabledReason}
            savedReplies={savedReplies}
            mentionableStaff={mentionableStaff}
            initialDraft={draft}
            composerPresence={composerPresence}
            currentStaffId={composerStaffId}
            composerNow={now}
            canUseCopilot={canUseCopilot}
            canManageSavedReplies={capabilities.manageSavedReplies}
            ownershipNotice={replyOwnershipNoticeFor({
              state: conversation.state,
              assignedToId: conversation.assigned_to_id,
              assignedToName: conversation.assigned_to_name,
              currentStaffId: composerStaffId,
            })}
            nextAction={nextAction}
            onSendStart={startPending}
            onSendAccepted={acceptPending}
            onSendFailed={failPending}
          />
        </>
      )}
    </div>
  );
}
