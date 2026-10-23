"use client";

import { FileText, Loader2, Minus, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { QuickChatTemplateStep } from "@/components/quick-chat/quick-chat-template-step";
import { Textarea } from "@/components/ui/textarea";
import type { QuickChatSendMode } from "@/lib/inbox/quick-chat/access";
import type { QuickChatAttachmentState } from "@/lib/inbox/quick-chat/attachment";
import { TEMPLATE_SENT_NOTICE } from "@/lib/inbox/quick-chat/template-step";
import type { QuickChatTarget } from "@/lib/inbox/quick-chat/resolve-target";
import type { QuickChatMessage } from "@/lib/inbox/quick-chat/thread";
import { inboxPageHref } from "@/lib/inbox/page-request";
import { cn } from "@/lib/utils";

export type QuickChatPanelState =
  | { phase: "idle" }
  | { phase: "resolving" }
  | { phase: "error"; message: string }
  | { phase: "ready"; conversationId: string; windowExpiresAt: string }
  | { phase: "unavailable"; target: Exclude<QuickChatTarget, { kind: "READY" }>; digits: string }
  /** A template went out; free text opens only once the customer replies. */
  | { phase: "template-sent"; conversationId: string };

interface QuickChatPanelProps {
  contactName: string;
  state: QuickChatPanelState;
  messages: QuickChatMessage[];
  draft: string;
  sending: boolean;
  minimised: boolean;
  /** Customer messages that arrived while the popup was minimised. */
  unread: number;
  sendMode: QuickChatSendMode;
  attachment: QuickChatAttachmentState;
  /** The page's file, named while free text is not available yet; it is staged once the conversation is ready. */
  waitingAttachmentName: string | null;
  canSend: boolean;
  onRetryAttachment: () => void;
  onRemoveAttachment: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onTemplateSent: (conversationId: string) => void;
  onRecheck: () => void;
  onToggleMinimised: () => void;
  onClose: () => void;
}

const DELIVERY_LABEL: Record<NonNullable<QuickChatMessage["deliveryStatus"]>, string> = {
  PENDING: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Not delivered",
};

/**
 * The popup's presentation. It sits at the bottom-left of the content area (inside the layout's `<main>`), so it follows the sidebar
 * instead of covering it. Status is always said in words, never by colour alone.
 */
export function QuickChatPanel({
  contactName,
  state,
  messages,
  draft,
  sending,
  minimised,
  unread,
  sendMode,
  attachment,
  waitingAttachmentName,
  canSend,
  onRetryAttachment,
  onRemoveAttachment,
  onDraftChange,
  onSend,
  onTemplateSent,
  onRecheck,
  onToggleMinimised,
  onClose,
}: QuickChatPanelProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const conversationId =
    state.phase === "ready" || state.phase === "template-sent"
      ? state.conversationId
      : state.phase === "unavailable"
        ? state.target.conversationId
        : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, minimised]);


  return (
    <section
      role="dialog"
      aria-label={`Chat with ${contactName}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className={cn(
        "absolute bottom-4 left-4 z-40 flex w-[min(22rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl",
        minimised ? "h-auto" : "h-[min(32rem,calc(100%-2rem))]",
      )}
    >
      <header className="flex items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{contactName}</p>
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            WhatsApp
            {unread > 0 ? ` · ${unread} new message${unread === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        {conversationId && (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<a href={inboxPageHref({ conversationId })} target="_blank" rel="noopener noreferrer" />}
          >
            Open in Inbox
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onToggleMinimised} aria-label={minimised ? "Expand chat" : "Minimise chat"}>
          <Minus />
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
          <X />
        </Button>
      </header>

      {!minimised && (
        <>
          <div className="custom-scroll flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {state.phase === "resolving" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Checking this chat…
              </p>
            )}
            {state.phase === "error" && <p className="text-sm text-destructive">{state.message}</p>}
            {state.phase === "unavailable" && state.target.kind === "BLOCKED" && (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground" role="status">
                {state.target.message}
              </p>
            )}
            {state.phase === "unavailable" && state.target.kind === "NEEDS_TEMPLATE" && sendMode === "RECORD" && (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground" role="status">
                A free-text message cannot be sent to this number right now: WhatsApp needs an approved template, and templates are sent by
                Operations. Ask them to send one, then try again.
              </p>
            )}
            {state.phase === "unavailable" && state.target.kind === "NEEDS_TEMPLATE" && sendMode === "INBOX" && (
              <QuickChatTemplateStep
                target={state.target}
                digits={state.digits}
                contactName={contactName}
                onTemplateSent={onTemplateSent}
              />
            )}
            {state.phase === "template-sent" && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3" role="status">
                <p className="text-sm text-foreground">{TEMPLATE_SENT_NOTICE}</p>
                <Button variant="outline" size="sm" onClick={onRecheck}>
                  Check again
                </Button>
              </div>
            )}
            {messages.length === 0 && state.phase === "ready" && (
              <p className="text-sm text-muted-foreground">No messages yet. Review the draft below and send it.</p>
            )}
            {messages.map((message) => (
              <div key={message.id} className={cn("flex flex-col", message.direction === "OUT" ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                    message.direction === "OUT" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {message.text}
                </div>
                <span className="mt-0.5 text-[10px] text-muted-foreground">
                  {message.direction === "OUT" && message.author ? `${message.author} · ` : ""}
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {message.deliveryStatus ? ` · ${DELIVERY_LABEL[message.deliveryStatus]}` : ""}
                </span>
                {message.deliveryStatus === "FAILED" && message.deliveryError && (
                  <span className="text-[10px] text-destructive">{message.deliveryError}</span>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-border p-2">
            {attachment.status !== "none" && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs" role="status">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{attachment.filename}</p>
                  <p className={attachment.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                    {attachment.status === "uploading" && "Uploading…"}
                    {attachment.status === "ready" && "Attached. It goes with your message."}
                    {attachment.status === "failed" && attachment.error}
                  </p>
                </div>
                {attachment.status === "failed" && sendMode === "INBOX" && (
                  <Button variant="ghost" size="sm" onClick={onRetryAttachment}>
                    Try again
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={onRemoveAttachment} aria-label="Remove the attached file">
                  <X />
                </Button>
              </div>
            )}
            {attachment.status === "none" && waitingAttachmentName && (
              <p className="mb-2 text-xs text-muted-foreground" role="status">
                {waitingAttachmentName} will be attached once a free-text message can be sent.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSend) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                disabled={state.phase !== "ready"}
                placeholder={
                  state.phase === "ready"
                    ? "Type a message"
                    : state.phase === "template-sent" || (state.phase === "unavailable" && draft)
                      ? "Your draft is kept here until free text is available"
                      : "Sending is not available for this chat"
                }
                aria-label="Message"
                rows={2}
                className="max-h-40 min-h-16 resize-none"
              />
              <Button size="icon" onClick={onSend} disabled={!canSend} aria-label="Send message">
                {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
              </Button>
            </div>
            {state.phase === "ready" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Reply window open until {new Date(state.windowExpiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Ctrl+Enter sends.
              </p>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
