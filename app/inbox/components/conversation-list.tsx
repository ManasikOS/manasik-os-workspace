"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  adjacentConversationId,
  INBOX_SEARCH_INPUT_ID,
} from "@/lib/inbox/keyboard-navigation";
import {
  resolveInboxShortcut,
  type InboxShortcutContext,
  type InboxShortcutId,
} from "@/lib/inbox/keyboard-shortcuts";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, ListChecks, MessageCircle } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import whatsappIcon from "@/public/source_logos/whatsapp.svg";
import emailIcon from "@/public/source_logos/email.png";

import InstagramIcon from "@/public/source_logos/instagram.svg";
import MessengerIcon from "@/public/source_logos/messenger.svg";

import type {
  InboxConversation,
  InboxMentionableStaff,
  InboxTemplate,
} from "../types";
import { InboxConversationPeekCard } from "./inbox-conversation-peek-card";
import { BulkSelectionBar } from "./bulk-selection-bar";
import { SavedViewsMenu } from "./saved-views-menu";
import { InboxConversationListEmptyState } from "./inbox-conversation-list-empty-state";
import { searchInboxConversationsAction } from "../dialog-actions";
import {
  INBOX_SEARCH_LIMIT,
  normaliseSearchQuery,
} from "@/lib/inbox/search-query";
import { QUEUE_CATALOGUE } from "@/lib/inbox/queues";
import { INBOX_VIEWS, VIEW_QUEUE, type InboxView } from "@/lib/inbox/views";
import { containsArabicScript } from "@/lib/inbox/arabic-script";
import { channelDisplayName } from "@/lib/inbox/composer-state";
import { inboxListMessagePreview } from "@/lib/inbox/message-preview";
import {
  contactAvatarColorClasses,
  contactAvatarInitials,
} from "@/lib/inbox/contact-avatar-color";
import SearchInput from "@/components/ui/search-input";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InboxNewConversationMenu } from "./inbox-new-conversation-menu";

const getChannelIcon = (channel: InboxConversation["channel"]) => {
  switch (channel) {
    case "WHATSAPP":
      return whatsappIcon;
    case "INSTAGRAM":
      return InstagramIcon;
    case "MESSENGER":
      return MessengerIcon;
    case "GMAIL":
      return emailIcon;
    default:
      return MessageCircle;
  }
};
/** Heading for each view, taken from the queue catalogue so a new queue never renders without a title. */
const VIEW_TITLE: Record<InboxView, string> = Object.fromEntries(
  INBOX_VIEWS.map((view) => [view, QUEUE_CATALOGUE[VIEW_QUEUE[view]].label]),
) as Record<InboxView, string>;

/** The list owns only J, K and /; the rest of the registry is claimed elsewhere. None of these needs a permission. */
const LIST_SHORTCUT_SCOPE: readonly InboxShortcutId[] = [
  "NEXT_CONVERSATION",
  "PREVIOUS_CONVERSATION",
  "FOCUS_SEARCH",
];
const LIST_SHORTCUT_CONTEXT: InboxShortcutContext = {
  conversationOpen: false,
  canReply: false,
  canWriteNote: false,
  canAssign: false,
  hasLead: false,
  hasBooking: false,
  hasDepartureGroup: false,
  canStartQuote: false,
  hasTransientSurface: false,
};

export default function ConversationList({
  conversations,
  activeId,
  activeView,
  onSelectConversation,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  assignableStaff = [],
  onSelectView,
  canBulkAssign = false,
  canBulkClose = false,
  totalInView = null,
  currentStaffId = null,
  templates,
  canStartChat,
  emailMailboxReady,
  onConversationCreated,
}: {
  /** The signed-in staff member, so the row card can say "Assigned to you". */
  currentStaffId?: string | null;
  /** How many chats the open queue holds across the whole agency (server count). Null until known. */
  totalInView?: number | null;
  templates: InboxTemplate[];

  canStartChat: boolean;
  emailMailboxReady: boolean;
  onConversationCreated: (conversationId: string) => void;
  /** Opens a queue; used when a saved view is applied. */
  onSelectView?: (view: InboxView) => void;
  /** Who a selection can be given to. The server checks each person again. */
  assignableStaff?: InboxMentionableStaff[];
  canBulkAssign?: boolean;
  canBulkClose?: boolean;
  conversations: InboxConversation[];
  activeId: string | null;
  activeView: InboxView;
  /** The row is passed too, so a search result that is not in the loaded list can still be opened. */
  onSelectConversation?: (
    conversationId: string,
    conversation?: InboxConversation,
  ) => void;
  /** More chats exist beyond the ones listed (the server returned a next-page cursor). */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const [query, setQuery] = useState("");
  // Selecting several chats to give them an owner or close them together. Off until asked for.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const canBulk =
    onSelectConversation !== undefined && (canBulkAssign || canBulkClose);
  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }
  function stopSelecting() {
    setSelecting(false);
    setSelectedIds([]);
  }
  // Matches from every conversation, read from the server. Typing filters the loaded chats at once; these replace them
  // when they arrive, and only for the exact text they were read for, so a slow answer never shows under newer text.
  const [serverResults, setServerResults] = useState<{
    query: string;
    rows: InboxConversation[];
  } | null>(null);
  // A failed search is remembered for the exact text it failed for, so the box can say so instead of waiting forever.
  const [failedSearch, setFailedSearch] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const searchText = normaliseSearchQuery(query);
  useEffect(() => {
    if (!searchText) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchInboxConversationsAction({ query: searchText })
        .then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setFailedSearch(null);
            setServerResults({ query: searchText, rows: result.data });
          } else {
            setFailedSearch(searchText);
          }
        })
        .catch(() => {
          if (!cancelled) setFailedSearch(searchText);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, searchRetry]);
  const allConversationMatches =
    searchText && serverResults?.query === searchText
      ? serverResults.rows
      : null;
  const searchFailed =
    searchText !== null &&
    failedSearch === searchText &&
    !allConversationMatches;

  const clientFiltered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return conversations;
    // A search long enough for the server never shows this partial list; it waits for the server's answer.
    if (searchText) return [];
    return conversations.filter((conversation) =>
      [
        conversation.contact_name,
        conversation.contact_phone,
        conversation.lead_reference,
        conversation.desired_package_name,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term)),
    );
  }, [conversations, query, searchText]);
  const filtered = allConversationMatches ?? clientFiltered;

  // J / K move through the chats as listed (search included), "/" jumps to the search box. Never while typing in a field.
  useEffect(() => {
    if (!onSelectConversation) return;
    const ids = filtered.map((conversation) => conversation.id);
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      // The registry decides which key means what and never lets one act while typing, composing or with a modifier.
      const resolution = resolveInboxShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          isComposing: event.isComposing || event.keyCode === 229,
          target: event.target as HTMLElement | null,
          pending: null,
          now: Date.now(),
        },
        LIST_SHORTCUT_CONTEXT,
        LIST_SHORTCUT_SCOPE,
      );
      if (resolution.kind !== "RUN") return;
      if (resolution.id === "FOCUS_SEARCH") {
        event.preventDefault();
        document.getElementById(INBOX_SEARCH_INPUT_ID)?.focus();
        return;
      }
      const next = adjacentConversationId(
        ids,
        activeId,
        resolution.id === "NEXT_CONVERSATION" ? 1 : -1,
      );
      if (!next) return;
      event.preventDefault();
      const nextRow = filtered.find((conversation) => conversation.id === next);
      onSelectConversation?.(next, nextRow);
      window.requestAnimationFrame(() =>
        document
          .querySelector('[data-inbox-list] [aria-current="true"]')
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeId, filtered, onSelectConversation]);

  return (
    <section
      className="flex h-full min-w-0 flex-col"
      aria-label="Conversation list"
    >
      <header className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {VIEW_TITLE[activeView] ?? "Conversations"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {totalInView !== null && totalInView > conversations.length
                ? `Showing ${conversations.length} of ${totalInView}`
                : `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canStartChat && (
              <InboxNewConversationMenu
                templates={templates}
                emailMailboxReady={emailMailboxReady}
                onConversationCreated={onConversationCreated}
              />
            )}
            {onSelectView && (
              <SavedViewsMenu
                activeView={activeView}
                currentSearch={searchText}
                onApply={(view, search) => {
                  onSelectView(view);
                  setQuery(search ?? "");
                }}
              />
            )}

            {canBulk && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant={selecting ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-pressed={selecting}
                      aria-label={
                        selecting ? "Stop selecting" : "Select conversations"
                      }
                      onClick={() =>
                        selecting ? stopSelecting() : setSelecting(true)
                      }
                    />
                  }
                >
                  <ListChecks aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>
                  {selecting ? "Stop selecting" : "Select conversations"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div>
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event)}
            placeholder="Search conversations"
            id={INBOX_SEARCH_INPUT_ID}
            ariaKeyShortcuts="/"
          />
          {searchText && (
            <p className="mt-1.5 text-xs text-muted-foreground" role="status">
              {searchFailed
                ? "Search failed. "
                : allConversationMatches
                  ? `Matches from all conversations${allConversationMatches.length >= INBOX_SEARCH_LIMIT ? " (first " + INBOX_SEARCH_LIMIT + ")" : ""}`
                  : "Searching all conversations…"}
              {searchFailed && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setFailedSearch(null);
                    setSearchRetry((count) => count + 1);
                  }}
                >
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
      </header>
      <div
        data-inbox-list
        className="min-h-0 flex-1 space-y-0 overflow-y-auto no-scrollbar px-0 pb-2"
      >
        {filtered.length === 0 && !(searchText && !allConversationMatches) && (
          <InboxConversationListEmptyState
            activeView={activeView}
            searchText={searchText}
            onClearSearch={() => setQuery("")}
          />
        )}
        {filtered.map((conversation) => {
          const lastActivityAt = [
            conversation.last_inbound_at,
            conversation.last_outbound_at,
          ]
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1);
          const selected = conversation.id === activeId;
          // The chat that is open is being read, so it never shows as unread.
          const unreadCount = selected ? 0 : conversation.unread_count;
          const lastMessagePreview = inboxListMessagePreview({
            content: conversation.last_message_content,
            messageType: conversation.last_message_type,
          });
          const conversationRow = (
            <>
              <div className="relative shrink-0 h-fit">
                <Avatar className="size-11">
                  <AvatarFallback
                    className={cn(
                      "text-sm font-medium",
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
                <span className="absolute bottom-0 -right-1 grid size-5 place-items-center">
                  <Image
                    width={18}
                    height={18}
                    src={getChannelIcon(conversation.channel)}
                    alt={channelDisplayName(conversation.channel)}
                  />
                  <span className="sr-only">
                    {channelDisplayName(conversation.channel)}
                  </span>
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 text-base flex-1 truncate",
                      unreadCount > 0 ? "font-semibold" : "font-medium",
                      selected && "text-primary",
                      containsArabicScript(
                        conversation.contact_name ??
                          conversation.contact_phone ??
                          "",
                      ) && "font-arabic",
                    )}
                  >
                    {conversation.contact_name || conversation.contact_phone}
                  </span>
                  {lastActivityAt && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(lastActivityAt), {
                        addSuffix: false,
                      })}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      unreadCount > 0
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {conversation.last_message_role === "assistant"
                      ? `You: ${lastMessagePreview}`
                      : lastMessagePreview}
                  </p>
                  {unreadCount > 0 && (
                    <Badge className="rounded-full px-1.5 font-number tabular-nums">
                      {unreadCount}
                      <span className="sr-only"> unread</span>
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex justify-end items-center gap-1.5">
                  {/* <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <ConversationStateChip state={conversation.state} />
                    {conversation.lead_stage && (
                      <Badge variant="outline_without_border" className="font-normal">
                        {conversation.lead_stage
                          .split("_")
                          .map(
                            (part) =>
                              part[0]?.toUpperCase() +
                              part.slice(1).toLocaleLowerCase(),
                          )
                          .join(" ")}
                      </Badge>
                    )}
                  </div> */}
                </div>
              </div>
            </>
          );

          const rowClassName = cn(
            "group relative flex border-b border-muted/90 w-full gap-3 rounded-xs px-3 py-4 text-left transition-colors hover:bg-muted/70 focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring",
            selected && "bg-muted/80 hover:bg-primary/10",
          );

          return (
            <Tooltip key={conversation.id}>
              <TooltipTrigger className={"w-full"} delay={400} render={<div />}>
                <div>
                  {onSelectConversation ? (
                    <button
                      key={conversation.id}
                      type="button"
                      className={rowClassName}
                      aria-current={selected && !selecting ? "true" : undefined}
                      role={selecting ? "checkbox" : undefined}
                      aria-checked={
                        selecting
                          ? selectedIds.includes(conversation.id)
                          : undefined
                      }
                      onClick={() =>
                        selecting
                          ? toggleSelected(conversation.id)
                          : onSelectConversation(conversation.id, conversation)
                      }
                    >
                      {selecting && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-1 grid size-4 shrink-0 place-items-center rounded-sm border",
                            selectedIds.includes(conversation.id)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input",
                          )}
                        >
                          {selectedIds.includes(conversation.id) && (
                            <Check className="size-3" />
                          )}
                        </span>
                      )}
                      {conversationRow}
                    </button>
                  ) : (
                    <Link
                      key={conversation.id}
                      href={`/inbox?view=${activeView}&conversation=${conversation.id}`}
                      className={rowClassName}
                      aria-current={selected ? "page" : undefined}
                    >
                      {conversationRow}
                    </Link>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                align="start"
                className="max-w-none items-start border p-3 text-foreground"
              >
                <InboxConversationPeekCard
                  conversation={conversation}
                  currentStaffId={currentStaffId}
                />
              </TooltipContent>
            </Tooltip>
          );
        })}
        {hasOlder && onLoadOlder && !searchText && (
          <div className="px-3 py-3">
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              className="w-full"
              disabled={loadingOlder}
              onClick={onLoadOlder}
            >
              {loadingOlder ? "Loading older chats…" : "Load older chats"}
            </Button>
          </div>
        )}
      </div>
      {selecting && canBulk && (
        <BulkSelectionBar
          selectedIds={selectedIds}
          staff={assignableStaff}
          canAssign={canBulkAssign}
          canClose={canBulkClose}
          inSpamView={activeView === "spam"}
          onDone={stopSelecting}
          onCancel={stopSelecting}
        />
      )}
    </section>
  );
}
