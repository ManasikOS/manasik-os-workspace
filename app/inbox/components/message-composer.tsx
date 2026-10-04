"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Send2 } from "reicon-react";
import {
  addInternalNote,
  claimConversationComposerAction,
  releaseConversationComposerAction,
  saveConversationDraft,
  sendStaffMessage,
  suggestConversationReplyAction,
} from "../actions";
import CreateSavedReplyDialog from "./create-saved-reply-dialog";
import { useInboxRefresh, useInboxScopedSync } from "./inbox-refresh-context";
import {
  INSERT_COMPOSER_DRAFT_EVENT,
  REQUEST_COMPOSER_SUGGEST_EVENT,
  type InsertComposerDraftDetail,
  type RequestComposerSuggestDetail,
} from "./composer-draft-event";
import type { InboxMentionableStaff, InboxSavedReply } from "../types";
import type { ComposerPresence } from "@/lib/inbox/composer-presence";
import { ComposerNoticeStrip } from "./composer-notice-strip";
import { composerPresenceMessage } from "@/lib/inbox/composer-presence";
import {
  ChevronDown,
  MessageSquareText,
  Plus,
  X,
} from "lucide-react";
import type { ReplyOwnershipNotice } from "@/lib/inbox/reply-ownership-notice";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { channelSupportsSubjectAndCcBcc } from "@/lib/inbox/composer-state";
import { parseAddressList } from "@/lib/inbox/email-message-metadata";
import type { EmailReplyFields } from "../actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NextBestAction } from "@/lib/inbox/next-best-action";
import { canSubmitComposer, enterKeyAction } from "@/lib/inbox/composer-keys";
import { createDraftSaver } from "@/lib/inbox/draft-saver";
import type { PendingSendStart } from "@/lib/inbox/pending-messages";
import { runPendingSend } from "@/lib/inbox/pending-send";
import {
  ComposerAttachButton,
  ComposerAttachmentChip,
  useComposerAttachment,
} from "./composer-attachment";
import VaultDialog from "@/components/vault/vault-dialog";
import type { VaultDocumentRow } from "@/lib/types/vault";

/**
 * Disabled unless the conversation is HUMAN_ACTIVE — the visible half of the
 * guard; `sendStaffMessage` re-checks state server-side regardless (§10.2).
 */
export default function MessageComposer({
  conversationId,
  channel,
  defaultSubject = null,
  enabled,
  canCollaborate,
  disabledReason,
  savedReplies,
  mentionableStaff,
  initialDraft,
  canUseCopilot,
  canManageSavedReplies = false,
  ownershipNotice = null,
  composerPresence,
  currentStaffId,
  composerNow,
  onSendStart,
  onSendAccepted,
  onSendFailed,
}: {
  conversationId: string;
  /** Email only: shows Subject/Cc/Bcc when `channelSupportsSubjectAndCcBcc(channel)`. */
  channel: string;
  /** The reply's starting subject — "Re: " plus the last inbound subject, computed by the panel. */
  defaultSubject?: string | null;
  enabled: boolean;
  canCollaborate: boolean;
  disabledReason: string;
  savedReplies: InboxSavedReply[];
  mentionableStaff: InboxMentionableStaff[];
  initialDraft: string;
  canUseCopilot: boolean;
  /** Shows "Create reply" in the Saved replies dropdown. The server checks again — matches `saved_replies`' RLS write policy. */
  canManageSavedReplies?: boolean;
  /** Shown when a colleague owns the chat, so replying is a deliberate choice. It never blocks sending. */
  ownershipNotice?: ReplyOwnershipNotice | null;
  /** What Copilot suggests doing next. It gets the prominent button; everything else stays under "More actions". */
  nextAction?: NextBestAction | null;
  composerPresence: ComposerPresence | null;
  currentStaffId: string | null;
  /** The conversation panel's minute clock makes a stale warning disappear without an action. */
  composerNow: Date;
  /**
   * Shows the message in the thread straight away. The composer generates the idempotency `key` for this send attempt and
   * hands it over: it becomes the pending message's id, is sent to the server, and comes back on the canonical message.
   */
  onSendStart?: (send: PendingSendStart) => void;
  /** The server confirmed the message exists (created now, or already stored by an earlier try with the same key). */
  onSendAccepted?: (key: string) => void;
  onSendFailed?: (key: string, error: string) => void;
}) {
  const [value, setValue] = useState(initialDraft);
  const attachment = useComposerAttachment(conversationId);
  const showEmailFields = channelSupportsSubjectAndCcBcc(channel);
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  // The default subject depends on which conversation (and which of its inbound messages) is open; a change means
  // a different chat, not an edit, so the field follows it unless the person is actively typing their own.
  const lastDefaultSubjectRef = useRef(defaultSubject);
  if (lastDefaultSubjectRef.current !== defaultSubject) {
    lastDefaultSubjectRef.current = defaultSubject;
    setSubject(defaultSubject ?? "");
  }
  // When replying is blocked (a closed reply window, for instance) the box opens on Note, the one thing that still works.
  const [mode, setMode] = useState<"reply" | "note">(
    enabled ? "reply" : "note",
  );
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [, setIsSuggesting] = useState(false);
  const [copilotProposalId, setCopilotProposalId] = useState<string | null>(
    null,
  );
  const [observedPresence, setObservedPresence] = useState(composerPresence);
  const [isComposing, setIsComposing] = useState(false);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [createReplyOpen, setCreateReplyOpen] = useState(false);
  // Shown immediately after creating one, until the next full-workspace refresh's `savedReplies` prop catches up.
  const [justCreatedReplies, setJustCreatedReplies] = useState<
    InboxSavedReply[]
  >([]);
  const isComposingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Draft saves go through one ordered queue; leaving the chat flushes the last words instead of dropping them.
  const [draftSaver] = useState(() =>
    createDraftSaver({
      save: (id, body) => saveConversationDraft(id, body),
      onError: (cause) => console.error("Could not save the draft", cause),
    }),
  );
  const lastDraftValueRef = useRef(initialDraft);
  const refreshInbox = useInboxRefresh();
  // A person's own send, note or composer claim reads only what it changed — never the whole workspace.
  const { syncThread, syncNotes, syncPresence } = useInboxScopedSync();

  const visibleSavedReplies = [
    ...justCreatedReplies.filter(
      (created) => !savedReplies.some((reply) => reply.id === created.id),
    ),
    ...savedReplies,
  ];

  const handleSavedReplyCreated = useCallback(
    (reply: InboxSavedReply) => {
      setJustCreatedReplies((current) => [reply, ...current]);
      refreshInbox();
    },
    [refreshInbox],
  );

  // Follow the server's presence when it changes: adjust state while rendering instead of in an effect.
  const [presenceFromServer, setPresenceFromServer] =
    useState(composerPresence);
  if (presenceFromServer !== composerPresence) {
    setPresenceFromServer(composerPresence);
    setObservedPresence(composerPresence);
  }

  const releaseComposerPresence = useCallback(() => {
    if (!isComposingRef.current) return;
    isComposingRef.current = false;
    setIsComposing(false);
    void releaseConversationComposerAction({ conversationId })
      .then(() => syncPresence())
      .catch((cause) =>
        console.error("Could not clear the writing indicator", cause),
      );
  }, [conversationId, syncPresence]);

  const claimComposerPresence = useCallback(() => {
    if (!enabled || !canCollaborate || mode !== "reply") return;
    isComposingRef.current = true;
    setIsComposing(true);
    void claimConversationComposerAction({ conversationId }).then((result) => {
      if (result.ok) setObservedPresence(result.presence);
      syncPresence();
    });
  }, [canCollaborate, conversationId, enabled, mode, syncPresence]);

  // A heartbeat turns an abandoned browser tab into a stale claim after two minutes. It never takes over a fresh colleague claim.
  useEffect(() => {
    if (!isComposing) return;
    const timer = window.setInterval(claimComposerPresence, 60_000);
    return () => window.clearInterval(timer);
  }, [claimComposerPresence, isComposing]);

  useEffect(() => {
    if (mode !== "reply") releaseComposerPresence();
  }, [mode, releaseComposerPresence]);

  // The component is keyed by conversation in the panel, so this is also the tab-close / conversation-switch release.
  useEffect(() => {
    return () => {
      if (!isComposingRef.current) return;
      isComposingRef.current = false;
      void releaseConversationComposerAction({ conversationId });
    };
  }, [conversationId]);

  const suggestReply = useCallback(() => {
    setError(null);
    setIsSuggesting(true);
    startTransition(async () => {
      const result = await suggestConversationReplyAction(conversationId);
      setIsSuggesting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValue(result.reply);
      setCopilotProposalId(result.proposalId);
    });
  }, [conversationId]);

  const handleSelectVaultDocument = useCallback(
    (document: VaultDocumentRow) => {
      setVaultPickerOpen(false);
      void attachment.chooseFromVault({
        id: document.id,
        fileName: document.file_name,
        fileSizeBytes: document.file_size_bytes,
      });
    },
    [attachment],
  );

  // The reply-window banner can ask for a draft without knowing about this box; only this conversation's box answers.
  useEffect(() => {
    function receiveSuggestRequest(event: Event) {
      const detail = (event as CustomEvent<RequestComposerSuggestDetail>)
        .detail;
      if (
        !enabled ||
        !canUseCopilot ||
        detail.conversationId !== conversationId
      )
        return;
      setMode("reply");
      suggestReply();
    }
    window.addEventListener(
      REQUEST_COMPOSER_SUGGEST_EVENT,
      receiveSuggestRequest,
    );
    return () =>
      window.removeEventListener(
        REQUEST_COMPOSER_SUGGEST_EVENT,
        receiveSuggestRequest,
      );
  }, [canUseCopilot, conversationId, enabled, suggestReply]);

  // The offer card can put a draft in the box. It only ever lands as editable text in the reply tab.
  useEffect(() => {
    function receiveDraft(event: Event) {
      const detail = (event as CustomEvent<InsertComposerDraftDetail>).detail;
      if (!enabled || detail.conversationId !== conversationId) return;
      setMode("reply");
      setValue(detail.text);
      setCopilotProposalId(null);
    }
    window.addEventListener(INSERT_COMPOSER_DRAFT_EVENT, receiveDraft);
    return () =>
      window.removeEventListener(INSERT_COMPOSER_DRAFT_EVENT, receiveDraft);
  }, [conversationId, enabled]);

  useEffect(() => {
    if (!canCollaborate || mode !== "reply") return;
    // Only a change is saved: opening a chat must not write (or delete) the draft it just read.
    if (value === lastDraftValueRef.current) return;
    lastDraftValueRef.current = value;
    draftSaver.schedule(conversationId, value);
  }, [canCollaborate, conversationId, draftSaver, mode, value]);

  // Leaving the chat (the composer is keyed by conversation) saves whatever was typed in the last moments.
  useEffect(() => () => draftSaver.flush(), [draftSaver]);

  const canSubmitNow = canSubmitComposer({
    mode,
    enabled,
    text: value,
    hasAttachment: attachment.state.status === "ready",
    attachmentUploading: attachment.state.status === "uploading",
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Enter reaches here even when the Send button is disabled, so the rule is checked again.
    if (!canSubmitNow) return;
    setError(null);

    const emailFields: EmailReplyFields | null = showEmailFields
      ? {
          subject,
          cc: parseAddressList(ccInput),
          bcc: parseAddressList(bccInput),
        }
      : null;

    if (mode === "reply" && onSendStart) {
      // Send-and-forget feel: clear the box and show the message at once; the server confirms in the background.
      const text = value;
      // One key per send attempt: a retry reuses it (the server returns the message it already stored), while a new
      // deliberate send — even with identical text — gets a fresh one.
      const key = crypto.randomUUID();
      const proposalId = copilotProposalId;
      const staged =
        attachment.state.status === "ready" ? attachment.state : null;
      // The pending bubble names the file when there is no caption, so the person sees what is going out.
      onSendStart({
        key,
        content: text.trim() || (staged ? `Sending ${staged.name}…` : ""),
        body: text,
        attachment: staged?.ref ?? null,
        proposalId,
      });
      attachment.clear();
      setValue("");
      lastDraftValueRef.current = "";
      draftSaver.clearNow(conversationId);
      releaseComposerPresence();
      setShowCcBcc(false);
      setCcInput("");
      setBccInput("");
      startTransition(() =>
        runPendingSend({
          key,
          send: () =>
            sendStaffMessage(
              conversationId,
              text,
              proposalId,
              key,
              staged?.ref ?? null,
              emailFields,
            ),
          onSucceeded: () => setCopilotProposalId(null),
          onAccepted: (acceptedKey) => onSendAccepted?.(acceptedKey),
          onFailed: (failedKey, reason) => onSendFailed?.(failedKey, reason),
          syncThread,
        }),
      );
      return;
    }

    startTransition(async () => {
      const result =
        mode === "note"
          ? await addInternalNote(conversationId, value, mentionedUserIds)
          : await sendStaffMessage(
              conversationId,
              value,
              copilotProposalId,
              undefined,
              attachment.state.status === "ready" ? attachment.state.ref : null,
              emailFields,
            );
      if (result.ok) {
        setValue("");
        if (mode === "reply") attachment.clear();
        setMentionedUserIds([]);
        if (mode === "reply") {
          lastDraftValueRef.current = "";
          draftSaver.clearNow(conversationId);
          setShowCcBcc(false);
          setCcInput("");
          setBccInput("");
        }
        if (mode === "reply") setCopilotProposalId(null);
        if (mode === "reply") releaseComposerPresence();
        if (mode === "note") syncNotes();
        else syncThread();
      } else {
        setError(result.error);
      }
    });
  }

  if (!enabled && !canCollaborate) {
    return (
      <div className="border-t px-4 py-3 text-xs text-muted-foreground bg-muted/30">
        {disabledReason}
      </div>
    );
  }

  return (
    <>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="border-t transition-all duration-300 border-muted-foreground/5 bg-card "
      >
        <ComposerNoticeStrip
          candidates={[
            error ? { kind: "ERROR", message: error } : null,
            !enabled ? { kind: "BLOCKED", message: disabledReason } : null,
            mode === "reply"
              ? {
                  kind: "PRESENCE",
                  message:
                    composerPresenceMessage(
                      observedPresence,
                      currentStaffId,
                      mentionableStaff,
                      composerNow,
                    ) ?? "",
                }
              : null,
            mode === "reply" && ownershipNotice
              ? { kind: "OWNERSHIP", message: ownershipNotice.message }
              : null,
          ]}
        />
        <div className=" p-3 transition-all duration-300">
          <div className="">
            {mode === "reply" && showEmailFields && (
              <div className="mb-2 flex flex-col gap-2">
                <InputGroup>
                  <InputGroupAddon align="block-start">Subject</InputGroupAddon>
                  <InputGroupInput
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    aria-label="Email subject"
                  />
                </InputGroup>
                {showCcBcc ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <InputGroup className="flex-1">
                      <InputGroupAddon align="block-start">Cc</InputGroupAddon>
                      <InputGroupInput
                        value={ccInput}
                        onChange={(e) => setCcInput(e.target.value)}
                        placeholder="cc@example.com"
                        aria-label="Cc recipients"
                      />
                    </InputGroup>
                    <InputGroup className="flex-1">
                      <InputGroupAddon align="block-start">Bcc</InputGroupAddon>
                      <InputGroupInput
                        value={bccInput}
                        onChange={(e) => setBccInput(e.target.value)}
                        placeholder="bcc@example.com"
                        aria-label="Bcc recipients"
                      />
                    </InputGroup>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setShowCcBcc(true)}
                  >
                    Add Cc/Bcc
                  </button>
                )}
              </div>
            )}
            {mode === "reply" && (
              <ComposerAttachmentChip
                state={attachment.state}
                onRemove={attachment.clear}
              />
            )}
            <InputGroupTextarea
              data-inbox-composer-field=""
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={claimComposerPresence}
              onBlur={releaseComposerPresence}
              placeholder={
                mode === "note"
                  ? "Write an internal note…"
                  : "Reply to the customer…"
              }
              className="min-h-16.5 bg-transparent! custom-scroll max-h-32 resize-none border-0 px-2 py-2 text-sm shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                const action = enterKeyAction({
                  key: e.key,
                  shiftKey: e.shiftKey,
                  isComposing: e.nativeEvent.isComposing,
                  canSubmit: canSubmitNow,
                });
                if (action === "SUBMIT") {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
            />
            <div className="flex justify-between w-full">
              <div className="flex items-center gap-1">
                <Tabs
                  className="shadow-xs!"
                  value={mode}
                  onValueChange={(value: string) =>
                    setMode(value as "reply" | "note")
                  }
                >
                  <TabsList>
                    <TabsTrigger
                      type="button"
                      value={"reply"}
                      disabled={!enabled}
                      title={
                        enabled
                          ? undefined
                          : "Replying is not available right now. See the note above."
                      }
                      data-inbox-shortcut-trigger={
                        enabled ? "FOCUS_REPLY" : undefined
                      }
                      aria-keyshortcuts={enabled ? "r" : undefined}
                    >
                      Reply
                    </TabsTrigger>
                    <TabsTrigger
                      type="button"
                      value={"note"}
                      data-inbox-shortcut-trigger="FOCUS_NOTE"
                      aria-keyshortcuts="n"
                    >
                      Internal note
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {mode === "note" && mentionableStaff.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          aria-label="Mention a staff member"
                          variant={"ghost"}
                          className={"flex flex-row"}
                        >
                          Mention staff
                          <ChevronDown className="size-3 opacity-60" />
                        </Button>
                      }
                    ></DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="start"
                      className="max-h-56 overflow-y-auto"
                    >
                      <DropdownMenuLabel>Staff members</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {mentionableStaff
                        .filter((staff) => !mentionedUserIds.includes(staff.id))
                        .map((staff) => (
                          <DropdownMenuItem
                            key={staff.id}
                            onClick={() => {
                              setMentionedUserIds((ids) => [...ids, staff.id]);
                              setValue(
                                (current) =>
                                  `${current}${current && !current.endsWith(" ") ? " " : ""}@${staff.name} `,
                              );
                            }}
                          >
                            {staff.name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* {mode === "reply" && canUseCopilot && (
                  <Button
                    type="button"
                    variant={
                      !nextAction || nextAction.primary === "DRAFT_REPLY"
                        ? "secondary"
                        : "ghost"
                    }
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={isSuggesting}
                    onClick={suggestReply}
                    aria-label={`Draft a reply with ${COPILOT_NAME}`}
                    title={`Draft a reply with ${COPILOT_NAME} — review before sending`}
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {isSuggesting ? "Drafting…" : "Draft with Copilot"}
                    </span>
                  </Button>
                )} */}

                <>
                  {mode === "reply" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            aria-label="Insert a saved reply"
                            title="Saved replies"
                            variant="ghost"
                            size="icon-sm"
                          >
                            <MessageSquareText aria-hidden="true" />
                          </Button>
                        }
                      ></DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="top"
                        align="start"
                        className="max-h-56 max-w-64 overflow-y-auto"
                      >
                        <DropdownMenuLabel>Saved replies</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {visibleSavedReplies.length === 0 && (
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            None yet.
                          </p>
                        )}
                        {visibleSavedReplies.map((reply) => (
                          <DropdownMenuItem
                            key={reply.id}
                            onClick={() =>
                              setValue((current) =>
                                current
                                  ? `${current}\n\n${reply.body}`
                                  : reply.body,
                              )
                            }
                          >
                            {reply.title}
                          </DropdownMenuItem>
                        ))}
                        {canManageSavedReplies && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setCreateReplyOpen(true)}
                            >
                              <Plus className="size-3.5" /> Create reply
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {mode === "reply" && (
                    <ComposerAttachButton
                      disabled={
                        !enabled ||
                        isPending ||
                        attachment.state.status === "uploading"
                      }
                      onChoose={attachment.choose}
                      onOpenVaultPicker={() => setVaultPickerOpen(true)}
                    />
                  )}
                  <Button
                    type="submit"
                    aria-label={mode === "note" ? "Add note" : "Send"}
                    className="gap-1.5 px-3"
                    disabled={!canSubmitNow || (mode === "note" && isPending)}
                  >
                    {mode === "note" ? (
                      "Add note"
                    ) : (
                      <>
                        <Send2 size={10} />
                      </>
                    )}
                  </Button>
                </>
              </div>
            </div>
          </div>
        </div>
        {mode === "note" && mentionedUserIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground">
            <span>Mentioning</span>
            {mentionableStaff
              .filter((staff) => mentionedUserIds.includes(staff.id))
              .map((staff) => (
                <span
                  key={staff.id}
                  className="inline-flex items-center gap-1 rounded-sm  bg-muted/70 py-1 shadow-xs px-2"
                >
                  @{staff.name}
                  <button
                    type="button"
                    aria-label={`Remove @${staff.name} from this note`}
                    className="rounded-full p-0.5 hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      setMentionedUserIds((ids) =>
                        ids.filter((id) => id !== staff.id),
                      );
                      // Best effort: drop the mention text too, so the box and the mention list don't disagree.
                      // A person who edited the "@name" text by hand keeps whatever they typed either way.
                      setValue((current) =>
                        current
                          .replace(`@${staff.name} `, "")
                          .replace(`@${staff.name}`, ""),
                      );
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
          </div>
        )}
      </form>
      {vaultPickerOpen && (
        <VaultDialog
          open={vaultPickerOpen}
          onOpenChange={setVaultPickerOpen}
          mode="picker"
          onSelect={handleSelectVaultDocument}
        />
      )}
      {createReplyOpen && (
        <CreateSavedReplyDialog
          open={createReplyOpen}
          onOpenChange={setCreateReplyOpen}
          onCreated={handleSavedReplyCreated}
        />
      )}
    </>
  );
}
