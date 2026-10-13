"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { markConversationRead, sendStaffMessage } from "@/app/inbox/actions";
import {
  loadQuickChatThreadAction,
  resolveQuickChatTargetAction,
  sendQuickChatRecordMessageAction,
} from "@/app/inbox/quick-chat-actions";
import { QuickChatPanel, type QuickChatPanelState } from "@/components/quick-chat/quick-chat-panel";
import { useQuickChatLive } from "@/components/quick-chat/use-quick-chat-live";
import { stageQuickChatAttachment } from "@/components/quick-chat/stage-attachment";
import { toast } from "@/components/ui/toast";
import { canSendQuickChat, type QuickChatAttachmentState } from "@/lib/inbox/quick-chat/attachment";
import { popupTakesSendButtons, type QuickChatSendMode } from "@/lib/inbox/quick-chat/access";
import { countUnreadInbound, latestMessageTime } from "@/lib/inbox/quick-chat/live";
import { createSingleFlightRunner } from "@/lib/inbox/realtime/single-flight-runner";
import {
  OPEN_QUICK_CHAT_EVENT,
  setQuickChatAvailable,
  type OpenQuickChatDetail,
} from "@/lib/inbox/quick-chat/open-quick-chat-event";
import type { QuickChatTarget } from "@/lib/inbox/quick-chat/resolve-target";
import type { QuickChatMessage } from "@/lib/inbox/quick-chat/thread";

interface Session {
  /** Changes on every open request, so a slow answer for an earlier request is ignored. */
  id: number;
  detail: OpenQuickChatDetail;
}

/**
 * The Quick Chat popup. Mounted once in the app layout; pages reach it only through `openQuickChat()`.
 * `enabled` is decided on the server (deployment flag AND the role may send), so a page that is not allowed never even announces.
 */
export function QuickChatProvider({
  enabled,
  agencyId,
  sendMode,
}: {
  enabled: boolean;
  agencyId: string | null;
  /** INBOX: the Inbox's own send. RECORD: Finance and Visa, WhatsApp text inside an open window only. Decided on the server. */
  sendMode: QuickChatSendMode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [minimised, setMinimised] = useState(false);
  const [state, setState] = useState<QuickChatPanelState>({ phase: "idle" });
  const [messages, setMessages] = useState<QuickChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const sessionId = useRef(0);
  const sendKey = useRef<string | null>(null);
  // The page's file, staged for the open conversation. `attachmentDone` is set once it was sent or removed, so a re-check of the screen
  // never stages (and could never send) the same file again.
  const [attachment, setAttachmentState] = useState<QuickChatAttachmentState>({ status: "none" });
  const attachmentRef = useRef<QuickChatAttachmentState>({ status: "none" });
  const attachmentDone = useRef(false);
  // The same fact for the screen, which may not read a ref while rendering.
  const [attachmentSettled, setAttachmentSettled] = useState(false);
  const markAttachmentDone = useCallback((done: boolean) => {
    attachmentDone.current = done;
    setAttachmentSettled(done);
  }, []);
  const stageRun = useRef(0);
  const setAttachment = useCallback((next: QuickChatAttachmentState) => {
    attachmentRef.current = next;
    setAttachmentState(next);
  }, []);
  // Customer messages up to this time have been looked at; a message newer than it, while minimised, counts as unread.
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const markedReadThrough = useRef<string | null>(null);

  useEffect(() => {
    // Pages fall back to wa.me for any role the popup does not serve yet (see RECORD_ROLES_USE_POPUP).
    setQuickChatAvailable(enabled && popupTakesSendButtons(sendMode));
    return () => setQuickChatAvailable(false);
  }, [enabled, sendMode]);

  const loadThread = useCallback(async (conversationId: string) => {
    const result = await loadQuickChatThreadAction({ conversationId });
    if (result.ok) setMessages(result.messages);
    return result.ok;
  }, []);

  /**
   * The newest messages of the open conversation, one read at a time. Signals that arrive while a read runs fold into one follow-up
   * (the Inbox's own single-flight rule), so an older snapshot can never overwrite a newer delivery status.
   */
  const threadRunner = useRef<ReturnType<typeof createSingleFlightRunner<string>> | null>(null);
  useEffect(() => {
    threadRunner.current = createSingleFlightRunner<string>(
      async (conversationId) => {
        await loadThread(conversationId);
      },
      (_queued, incoming) => incoming,
    );
  }, [loadThread]);

  const stage = useCallback(
    async (conversationId: string, input: NonNullable<OpenQuickChatDetail["attachment"]>) => {
      const run = ++stageRun.current;
      setAttachment({ status: "uploading", filename: input.filename, byteSize: input.file.size });
      const settled = await stageQuickChatAttachment(conversationId, input);
      if (run === stageRun.current) setAttachment(settled);
    },
    [setAttachment],
  );

  const start = useCallback(
    async (detail: OpenQuickChatDetail, options?: { keepDraft?: boolean }) => {
      const id = ++sessionId.current;
      sendKey.current = null;
      if (!options?.keepDraft) {
        // A different chat: nothing about the previous one has been seen or marked read yet.
        markedReadThrough.current = null;
        setSeenAt(null);
        stageRun.current += 1;
        markAttachmentDone(false);
        setAttachment({ status: "none" });
      }
      setSession({ id, detail });
      setMinimised(false);
      // A re-check keeps what is on screen, so the thread does not blink while the screen is worked out again.
      if (!options?.keepDraft) {
        setMessages([]);
        setDraft(detail.draft ?? "");
      }
      setState({ phase: "resolving" });

      const resolved = await resolveQuickChatTargetAction({ channel: detail.channel, to: detail.to });
      if (id !== sessionId.current) return;
      if (!resolved.ok) {
        setState({ phase: "error", message: resolved.error });
        return;
      }
      const target: QuickChatTarget = resolved.target;
      if (target.kind === "READY") {
        setState({ phase: "ready", conversationId: target.conversationId, windowExpiresAt: target.windowExpiresAt });
        if (detail.attachment && !attachmentDone.current && attachmentRef.current.status === "none") {
          if (sendMode === "RECORD") {
            // Finance and Visa send text only from here; the file must be removed before the text can go.
            setAttachment({
              status: "failed",
              filename: detail.attachment.filename,
              byteSize: detail.attachment.file.size,
              error: "Files cannot be sent from here with your role. Remove the file to send the text, or send it from the record.",
            });
          } else {
            void stage(target.conversationId, detail.attachment);
          }
        }
        const loaded = await loadThread(target.conversationId);
        if (id === sessionId.current && !loaded) {
          setState({ phase: "error", message: "The messages could not be loaded. Please try again." });
        }
        return;
      }
      setState({ phase: "unavailable", target, digits: resolved.digits });
      if (target.conversationId) void loadThread(target.conversationId);
    },
    [loadThread, markAttachmentDone, sendMode, setAttachment, stage],
  );

  useEffect(() => {
    if (!enabled) return;
    function onOpen(event: Event) {
      void start((event as CustomEvent<OpenQuickChatDetail>).detail);
    }
    window.addEventListener(OPEN_QUICK_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_CHAT_EVENT, onOpen);
  }, [enabled, start]);

  const send = useCallback(async () => {
    if (!session || state.phase !== "ready" || sending) return;
    const body = draft.trim();
    const file = attachmentRef.current.status === "ready" ? attachmentRef.current.ref : null;
    if (!canSendQuickChat({ draft, attachment: attachmentRef.current })) return;
    // One key per attempt: a double click or a retry of the same text can never send twice.
    const key = sendKey.current ?? crypto.randomUUID();
    sendKey.current = key;
    setSending(true);
    const result =
      sendMode === "RECORD"
        ? await sendQuickChatRecordMessageAction({ conversationId: state.conversationId, body, clientIdempotencyKey: key })
        : await sendStaffMessage(state.conversationId, body, null, key, file);
    setSending(false);
    if (!result.ok) {
      toast.add({ title: "Message not sent", description: result.error });
      return;
    }
    sendKey.current = null;
    setDraft("");
    if (file) {
      markAttachmentDone(true);
      setAttachment({ status: "none" });
    }
    void loadThread(state.conversationId);
    try {
      await session.detail.onSent?.({ conversationId: state.conversationId, messageId: result.messageId ?? null });
    } catch (cause) {
      console.error("Quick Chat onSent failed", cause instanceof Error ? cause.message : cause);
      toast.add({
        title: "Message sent, but the record was not updated",
        description: "Open the record and mark it as sent by hand.",
      });
    }
  }, [draft, loadThread, markAttachmentDone, sendMode, sending, session, setAttachment, state]);

  const retryAttachment = useCallback(() => {
    const input = session?.detail.attachment;
    if (input && state.phase === "ready" && sendMode === "INBOX") void stage(state.conversationId, input);
  }, [sendMode, session, stage, state]);

  const removeAttachment = useCallback(() => {
    stageRun.current += 1;
    markAttachmentDone(true);
    setAttachment({ status: "none" });
  }, [markAttachmentDone, setAttachment]);

  const onTemplateSent = useCallback(
    (conversationId: string) => {
      setState({ phase: "template-sent", conversationId });
      void loadThread(conversationId);
    },
    [loadThread],
  );

  const recheck = useCallback(() => {
    if (session) void start(session.detail, { keepDraft: true });
  }, [session, start]);

  const conversationId =
    state.phase === "ready" || state.phase === "template-sent"
      ? state.conversationId
      : state.phase === "unavailable"
        ? state.target.conversationId
        : null;
  // Waiting for the customer: a reply opens the 24-hour window, so the screen is worked out again instead of waiting for a click.
  const waitingForCustomer =
    state.phase === "template-sent" ||
    (state.phase === "unavailable" && state.target.kind === "NEEDS_TEMPLATE" && state.target.reason === "WINDOW_CLOSED");

  // The conversation being watched. It is kept while the screen is worked out again (the state briefly has no conversation), so the
  // subscription is not torn down and re-made on every re-check, which would trigger another re-check.
  const [watchedId, setWatchedId] = useState<string | null>(null);
  if (conversationId && conversationId !== watchedId) setWatchedId(conversationId);

  const onLiveChange = useCallback(() => {
    if (!watchedId) return;
    if (waitingForCustomer && session) {
      void start(session.detail, { keepDraft: true });
      return;
    }
    threadRunner.current?.submit(watchedId);
  }, [watchedId, session, start, waitingForCustomer]);

  useQuickChatLive({ agencyId, conversationId: session ? watchedId : null, onChange: onLiveChange });

  // While the popup is open and not minimised, what is on screen has been seen (adjusted during render, not in an effect).
  const latestSeen = session && !minimised ? latestMessageTime(messages) : null;
  if (session && !minimised && latestSeen !== seenAt) setSeenAt(latestSeen);

  // ...and the conversation is marked read in the Inbox too.
  useEffect(() => {
    // Marking read changes the conversation, which Finance and Visa may not do; their popup only shows.
    if (!session || minimised || !conversationId || sendMode === "RECORD") return;
    if (countUnreadInbound(messages, markedReadThrough.current) > 0) {
      markedReadThrough.current = latestMessageTime(messages);
      void markConversationRead(conversationId);
    }
  }, [messages, minimised, session, conversationId, sendMode]);

  const unread = minimised ? countUnreadInbound(messages, seenAt) : 0;

  const close = useCallback(() => {
    markedReadThrough.current = null;
    setSeenAt(null);
    setWatchedId(null);
    sessionId.current += 1;
    stageRun.current += 1;
    markAttachmentDone(false);
    setAttachment({ status: "none" });
    setSession(null);
    setState({ phase: "idle" });
    setMessages([]);
    setDraft("");
  }, [markAttachmentDone, setAttachment]);

  if (!enabled || !session) return null;

  return (
    <QuickChatPanel
      contactName={session.detail.contactName}
      state={state}
      messages={messages}
      draft={draft}
      sending={sending}
      minimised={minimised}
      unread={unread}
      sendMode={sendMode}
      attachment={attachment}
      waitingAttachmentName={
        state.phase !== "ready" && session.detail.attachment && !attachmentSettled ? session.detail.attachment.filename : null
      }
      canSend={state.phase === "ready" && !sending && canSendQuickChat({ draft, attachment })}
      onRetryAttachment={retryAttachment}
      onRemoveAttachment={removeAttachment}
      onDraftChange={(next) => {
        sendKey.current = null;
        setDraft(next);
      }}
      onSend={() => void send()}
      onTemplateSent={onTemplateSent}
      onRecheck={recheck}
      onToggleMinimised={() => setMinimised((value) => !value)}
      onClose={close}
    />
  );
}
