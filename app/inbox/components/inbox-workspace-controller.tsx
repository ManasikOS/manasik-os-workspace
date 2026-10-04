"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InboxWorkspaceContent } from "@/app/inbox/components/inbox-workspace-content";
import {
  loadInboxConversationAction,
  loadInboxConversationListPatchAction,
  loadInboxIntelligenceAction,
  loadInboxLeadContextAction,
  loadInboxListAction,
  loadInboxNotesDeltaAction,
  loadInboxPresenceAction,
  loadInboxThreadDeltaAction,
} from "@/app/inbox/dialog-actions";
import type {
  InboxConversation,
  InboxConversationData,
  InboxCustomerContext,
  InboxIntelligenceData,
  InboxListData,
} from "@/app/inbox/types";
import { Button } from "@/components/ui/button";
import { markConversationRead } from "@/app/inbox/actions";
import { toast } from "@/components/ui/toast";
import type { InboxView } from "@/lib/inbox/views";
import type { QueueCursor } from "@/lib/data/inbox-queue-repository";
import {
  highestMessageSequence,
  mergeListPatch,
  mergeNotesDelta,
  mergeThreadDelta,
  newestNotePosition,
  pruneOlderChats,
} from "@/lib/inbox/realtime/inbox-sync-merge";
import {
  inboxPageHref,
  inboxPageRequestFromSearchParams,
} from "@/lib/inbox/page-request";
import { finishRouteProgress, startRouteProgress } from "@/lib/route-progress";
import type { InboxSyncPlan } from "@/lib/inbox/realtime/inbox-sync-plan";
import {
  createSingleFlightRunner,
  type SingleFlightRunner,
} from "@/lib/inbox/realtime/single-flight-runner";
import type { InboxScopedSync } from "@/app/inbox/components/inbox-refresh-context";

function currentInboxAddress(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Adds one history entry for the chat a person opened, unless the address and screen already say so. */
function pushInboxAddress(
  thread: boolean,
  view: InboxView,
  conversationId: string,
): void {
  const href = inboxPageHref({ view, conversationId });
  if (
    href === currentInboxAddress() &&
    window.history.state?.inboxThread === thread
  )
    return;
  window.history.pushState(
    { ...window.history.state, inboxThread: thread },
    "",
    href,
  );
}

/** A backlog larger than one delta page is read page by page; this bounds the loop so a bad response cannot spin. */
const MAX_THREAD_DELTA_PAGES = 5;
/** The same bound for notes. */
const MAX_NOTES_DELTA_PAGES = 5;

type ThreadSyncPlan = NonNullable<InboxSyncPlan["thread"]>;
type NotesSyncPlan = NonNullable<InboxSyncPlan["notes"]>;

type InboxListRequest = {
  conversationId: string | null;
  view: InboxView;
};

const INITIAL_INBOX_LIST_REQUEST: InboxListRequest = {
  conversationId: null,
  view: "all",
};

/**
 * Loads the Inbox in four independent steps so each part appears as soon as
 * it is ready: chat list first, then the open conversation, then the lead
 * panel and Copilot's reading side by side. Only a first load (or switching to a different conversation) shows
 * a skeleton; every later refresh keeps what is on screen and swaps in the
 * new data, so only what changed updates.
 */
export function InboxWorkspaceController({
  open,
  initialRequest,
  fullPage = false,
}: {
  /** True while the workspace should be loaded: the overlay is open, or the page is showing. */
  open: boolean;
  /** Set on the full-page Inbox; the overlay leaves it off and offers a link to the page instead. */
  fullPage?: boolean;
  initialRequest: {
    conversationId: string | null;
    view: InboxView;
  };
}) {
  const [listData, setListData] = useState<InboxListData | null>(null);
  // Pages the person asked for beyond the first. A refresh reloads only the first page, so these are kept beside it.
  const [olderChats, setOlderChats] = useState<{
    conversations: InboxListData["conversations"];
    nextCursor: QueueCursor | null;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Below md the screen shows either the list or the open chat. A link to one chat opens on that chat; otherwise the list.
  const [mobileThreadOpen, setMobileThreadOpen] = useState(
    initialRequest.conversationId !== null,
  );
  // A queue the person chose adds a history entry once its list arrives (a failed switch must not leave one behind).
  const pushViewAddressRef = useRef(false);
  const [conversationData, setConversationData] =
    useState<InboxConversationData | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [leadContext, setLeadContext] = useState<InboxCustomerContext | null>(
    null,
  );
  const [leadError, setLeadError] = useState<string | null>(null);
  const [intelligence, setIntelligence] =
    useState<InboxIntelligenceData | null>(null);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(
    null,
  );

  // The latest conversation data, readable inside async deltas without waiting for a re-render.
  const conversationDataRef = useRef<InboxConversationData | null>(null);
  // Per-conversation list version the browser already holds: a patch older than it is ignored.
  const heldVersionsRef = useRef(new Map<string, number>());
  const listPatchSequenceRef = useRef(new Map<string, number>());
  const threadSyncSequenceRef = useRef(0);
  const notesSyncSequenceRef = useRef(0);
  const presenceSyncSequenceRef = useRef(0);
  // Runners are created in effects and held in refs (never during render): each serialises its reads and folds anything that
  // arrives meanwhile into one follow-up. Unmounting or re-creating one abandons whatever it had queued.
  const threadRunnerRef = useRef<SingleFlightRunner<ThreadSyncPlan> | null>(
    null,
  );
  const notesRunnerRef = useRef<SingleFlightRunner<NotesSyncPlan> | null>(null);
  // A change that arrived while the open chat was still loading has nowhere to be merged; the load itself may have read
  // before it happened, so one catch-up read is made as soon as the chat is on screen.
  const catchUpAfterLoadRef = useRef(false);

  const commitConversationData = useCallback(
    (next: InboxConversationData | null) => {
      conversationDataRef.current = next;
      setConversationData(next);
    },
    [],
  );

  const viewRef = useRef<InboxView>("all");
  // Prevent an earlier queue request from ending the top loader while a newer queue is still loading.
  const viewNavigationSequenceRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const listSequenceRef = useRef(0);
  const conversationSequenceRef = useRef(0);
  const leadSequenceRef = useRef(0);
  const intelligenceSequenceRef = useRef(0);

  const loadConversationPart = useCallback(
    async (conversationId: string, silent: boolean) => {
      const sequence = ++conversationSequenceRef.current;
      if (!silent) {
        commitConversationData(null);
        setConversationError(null);
      }

      const result = await loadInboxConversationAction({ conversationId });
      if (sequence !== conversationSequenceRef.current) return;

      if (!result.ok) {
        if (!silent) setConversationError(result.error);
        return;
      }
      setConversationError(null);
      commitConversationData(result.data);
      if (catchUpAfterLoadRef.current) {
        catchUpAfterLoadRef.current = false;
        threadRunnerRef.current?.submit({
          refetchNewer: true,
          messageIds: [],
          fullReload: false,
        });
        notesRunnerRef.current?.submit({ refetchNewer: true, noteIds: [] });
      }
    },
    [commitConversationData],
  );

  const loadLeadPart = useCallback(
    async (conversationId: string, silent: boolean) => {
      const sequence = ++leadSequenceRef.current;
      if (!silent) {
        setLeadContext(null);
        setLeadError(null);
      }

      const result = await loadInboxLeadContextAction({ conversationId });
      if (sequence !== leadSequenceRef.current) return;

      if (!result.ok) {
        if (!silent) setLeadError(result.error);
        return;
      }
      setLeadError(null);
      setLeadContext(result.data);
    },
    [],
  );

  // Copilot's reading is its own load: a slow projection read never delays the messages or the lead panel, and a
  // realtime change to it (silent) swaps the new reading in without a skeleton.
  const loadIntelligencePart = useCallback(
    async (conversationId: string, silent: boolean) => {
      const sequence = ++intelligenceSequenceRef.current;
      if (!silent) {
        setIntelligence(null);
        setIntelligenceError(null);
      }

      const result = await loadInboxIntelligenceAction({ conversationId });
      if (sequence !== intelligenceSequenceRef.current) return;

      if (!result.ok) {
        if (!silent) setIntelligenceError(result.error);
        return;
      }
      setIntelligenceError(null);
      setIntelligence(result.data);
    },
    [],
  );

  const loadChatListPart = useCallback(
    async (request: InboxListRequest, isFirstLoad: boolean) => {
      const sequence = ++listSequenceRef.current;
      // The view on screen changes only when the new list arrives (below), so a read that is still in flight, a live row patch
      // or a "load more" never mixes the old list with the new view's rules.
      if (isFirstLoad) {
        activeConversationIdRef.current = null;
        setListData(null);
        setListError(null);
        commitConversationData(null);
        setLeadContext(null);
        setIntelligence(null);
      }

      const result = await loadInboxListAction(request);
      if (sequence !== listSequenceRef.current) return;

      if (!result.ok) {
        // Keep what is on screen; only a first load can fail hard. Any other failure says so, so the old list is never
        // mistaken for the queue the person just asked for.
        if (isFirstLoad) setListError(result.error);
        else if (request.view !== viewRef.current) {
          pushViewAddressRef.current = false;
          toast.add({
            title: "Could not open that queue",
            description: result.error,
          });
        }
        return;
      }

      let data = result.data;
      const chosenId = activeConversationIdRef.current;
      // A refresh started before the person picked another chat must not
      // switch them back to the chat that was open when it started.
      if (
        request.conversationId !== null &&
        chosenId !== null &&
        chosenId !== request.conversationId
      ) {
        data = {
          ...data,
          activeConversationId: chosenId,
          activeConversation:
            data.conversations.find((chat) => chat.id === chosenId) ?? null,
        };
      }

      const viewChanged = isFirstLoad || viewRef.current !== request.view;
      viewRef.current = request.view;
      if (viewChanged) {
        setOlderChats(null);
        // A full read is the freshest truth for a new view: versions held for another view's rows must not outrank it.
        heldVersionsRef.current.clear();
      } else {
        // Loaded older pages are kept, except rows the fresh first page proves have left the view.
        setOlderChats((current) => {
          if (!current) return current;
          if (data.nextCursor === null) return null;
          return {
            ...current,
            conversations: pruneOlderChats(
              current.conversations,
              data.conversations,
            ),
          };
        });
      }
      for (const row of data.conversations) {
        const version = (row as { version?: number | null }).version;
        if (typeof version === "number")
          heldVersionsRef.current.set(row.id, version);
      }

      const nextActiveId = data.activeConversationId;
      const activeChanged = nextActiveId !== chosenId;
      activeConversationIdRef.current = nextActiveId;
      setListData(data);

      if (!nextActiveId) {
        conversationSequenceRef.current += 1;
        leadSequenceRef.current += 1;
        intelligenceSequenceRef.current += 1;
        commitConversationData(null);
        setLeadContext(null);
        setIntelligence(null);
        return;
      }
      if (activeChanged) {
        // Conversation and lead only need the chat id, so they start together.
        void loadConversationPart(nextActiveId, false);
        void loadLeadPart(nextActiveId, false);
        void loadIntelligencePart(nextActiveId, false);
      }
    },
    [
      commitConversationData,
      loadConversationPart,
      loadLeadPart,
      loadIntelligencePart,
    ],
  );

  const resetInboxDialog = useCallback(() => {
    listSequenceRef.current += 1;
    conversationSequenceRef.current += 1;
    leadSequenceRef.current += 1;
    intelligenceSequenceRef.current += 1;
    threadSyncSequenceRef.current += 1;
    notesSyncSequenceRef.current += 1;
    presenceSyncSequenceRef.current += 1;
    heldVersionsRef.current.clear();
    listPatchSequenceRef.current.clear();
    viewRef.current = INITIAL_INBOX_LIST_REQUEST.view;
    activeConversationIdRef.current = null;
    setListData(null);
    setOlderChats(null);
    setListError(null);
    commitConversationData(null);
    setConversationError(null);
    setLeadContext(null);
    setLeadError(null);
    setIntelligence(null);
    setIntelligenceError(null);
  }, [commitConversationData]);

  useEffect(() => {
    if (open) {
      // Opening the controlled dialog is the synchronization boundary for its server-backed state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadChatListPart(initialRequest, true);
      return;
    }
    // Closing invalidates in-flight reads and clears data before the next open.
    resetInboxDialog();
  }, [initialRequest, loadChatListPart, open, resetInboxDialog]);

  const openConversation = useCallback(
    (
      conversationId: string,
      chosen: InboxConversation | undefined,
      pushHistory: boolean,
    ) => {
      setMobileThreadOpen(true);
      if (pushHistory && fullPage) {
        // On a wide screen the same chat is already showing: nothing to add. On a phone this tap is what opens it.
        const alreadyOpen = conversationId === activeConversationIdRef.current;
        if (!alreadyOpen || window.matchMedia("(max-width: 767px)").matches) {
          pushInboxAddress(true, viewRef.current, conversationId);
        }
      }
      if (conversationId === activeConversationIdRef.current) return;
      activeConversationIdRef.current = conversationId;
      // The list already has this chat (or the search that found it handed it over), so the header can switch at once.
      setListData((current) =>
        current
          ? {
              ...current,
              activeConversationId: conversationId,
              activeConversation:
                current.conversations.find(
                  (chat) => chat.id === conversationId,
                ) ??
                chosen ??
                null,
            }
          : current,
      );
      void loadConversationPart(conversationId, false);
      void loadLeadPart(conversationId, false);
      void loadIntelligencePart(conversationId, false);
    },
    [fullPage, loadConversationPart, loadLeadPart, loadIntelligencePart],
  );
  const selectConversation = useCallback(
    (conversationId: string, chosen?: InboxConversation) =>
      openConversation(conversationId, chosen, true),
    [openConversation],
  );

  // On the full page the address follows the open chat and queue, so a refresh or a shared link returns to the same place.
  // replaceState (not a navigation) keeps the workspace as it is; the server page is not asked for anything. A queue the
  // person chose is a history entry (pushed once its list arrives), so the browser's Back button returns to the one before.
  const shownConversationId = listData?.activeConversationId ?? null;
  const shownView = listData?.activeView ?? null;
  useEffect(() => {
    if (!fullPage || !shownView) return;
    const href = inboxPageHref({
      view: shownView,
      conversationId: shownConversationId,
    });
    const push = pushViewAddressRef.current;
    pushViewAddressRef.current = false;
    if (href === currentInboxAddress()) return;
    if (push)
      window.history.pushState(
        { ...window.history.state, inboxThread: false },
        "",
        href,
      );
    else window.history.replaceState(window.history.state, "", href);
  }, [fullPage, shownConversationId, shownView]);

  // The entry the page opened on records whether it showed a chat, so Back can return to it correctly.
  useEffect(() => {
    if (!fullPage) return;
    window.history.replaceState(
      {
        ...window.history.state,
        inboxThread: initialRequest.conversationId !== null,
      },
      "",
    );
  }, [fullPage, initialRequest.conversationId]);

  // Opening a chat reads it. While it stays open (and the tab is shown), a message that arrives is read too. The row is cleared
  // on screen at once; the database change then arrives as the usual list patch. One attempt per chat and unread count, so a
  // failure never loops.
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const readAttemptRef = useRef<string | null>(null);
  const openUnreadCount = listData?.activeConversation?.unread_count ?? 0;
  useEffect(() => {
    if (!tabVisible || !shownConversationId || openUnreadCount <= 0) return;
    // On a phone the first chat is selected behind the list; it is not read until the person actually opens it.
    if (!mobileThreadOpen && !window.matchMedia("(min-width: 768px)").matches)
      return;
    const attempt = `${shownConversationId}:${openUnreadCount}`;
    if (readAttemptRef.current === attempt) return;
    readAttemptRef.current = attempt;
    const readId = shownConversationId;
    const clearRow = (chat: InboxConversation) =>
      chat.id === readId ? { ...chat, unread_count: 0 } : chat;
    void markConversationRead(readId).then((result) => {
      if (!result.ok) return;
      setListData((current) =>
        current
          ? {
              ...current,
              conversations: current.conversations.map(clearRow),
              activeConversation: current.activeConversation
                ? clearRow(current.activeConversation)
                : null,
            }
          : current,
      );
      setOlderChats((current) =>
        current
          ? { ...current, conversations: current.conversations.map(clearRow) }
          : current,
      );
    });
  }, [mobileThreadOpen, openUnreadCount, shownConversationId, tabVisible]);

  const selectView = useCallback(
    (view: InboxView) => {
      setMobileThreadOpen(false);
      if (view === viewRef.current) return;

      pushViewAddressRef.current = true;
      const navigationSequence = ++viewNavigationSequenceRef.current;
      startRouteProgress();
      void loadChatListPart({ conversationId: null, view }, false).finally(
        () => {
          if (navigationSequence === viewNavigationSequenceRef.current) {
            finishRouteProgress();
          }
        },
      );
    },
    [loadChatListPart],
  );

  // Back and Forward: show the queue and chat the address names, without adding history of their own.
  useEffect(() => {
    if (!fullPage) return;
    function followAddress(event: PopStateEvent) {
      const params = new URLSearchParams(window.location.search);
      const request = inboxPageRequestFromSearchParams({
        conversation: params.get("conversation") ?? undefined,
        view: params.get("view") ?? undefined,
      });
      setMobileThreadOpen(event.state?.inboxThread === true);
      pushViewAddressRef.current = false;
      if (request.view !== viewRef.current) {
        void loadChatListPart(
          { conversationId: request.conversationId, view: request.view },
          false,
        );
      } else if (
        request.conversationId &&
        request.conversationId !== activeConversationIdRef.current
      ) {
        openConversation(request.conversationId, undefined, false);
      }
    }
    window.addEventListener("popstate", followAddress);
    return () => window.removeEventListener("popstate", followAddress);
  }, [fullPage, loadChatListPart, openConversation]);

  // "All chats" on a phone: back to the list. When the chat was opened from the list that is the browser's Back; when the page
  // opened straight on a chat there is nothing behind it inside the Inbox, so only the screen changes.
  const closeMobileThread = useCallback(() => {
    if (
      fullPage &&
      window.history.state?.inboxThread === true &&
      window.history.length > 1
    ) {
      window.history.back();
      return;
    }
    setMobileThreadOpen(false);
    if (fullPage)
      window.history.replaceState(
        { ...window.history.state, inboxThread: false },
        "",
      );
  }, [fullPage]);

  const openCreatedConversation = useCallback(
    (conversationId: string) => {
      // The new chat is not in the current list yet, so reload the list and
      // let it open the new chat once it arrives.
      activeConversationIdRef.current = null;
      setMobileThreadOpen(true);
      if (fullPage) pushInboxAddress(true, viewRef.current, conversationId);
      void loadChatListPart({ conversationId, view: viewRef.current }, false);
    },
    [fullPage, loadChatListPart],
  );

  // Staff deleted the open chat: leave it, drop its address, and reload the list so the server picks what to show next.
  const leaveDeletedConversation = useCallback(() => {
    activeConversationIdRef.current = null;
    setMobileThreadOpen(false);
    if (fullPage)
      window.history.replaceState(
        { ...window.history.state, inboxThread: false },
        "",
        inboxPageHref({ view: viewRef.current, conversationId: null }),
      );
    void loadChatListPart({ conversationId: null, view: viewRef.current }, false);
  }, [fullPage, loadChatListPart]);

  // The next-page rows, readable inside an async patch without waiting for a re-render.
  const olderChatsRef = useRef(olderChats);
  useEffect(() => {
    olderChatsRef.current = olderChats;
  }, [olderChats]);

  /* ── Incremental synchronisation (docs/inbox/scaling.md §8) ─────────────────────────────────────────────────────
   * A realtime plan names the few scoped reads a burst of events needs. Nothing here reloads the workspace, and nothing
   * shows a skeleton: each read patches what is on screen. Thread and note reads run one at a time (see
   * single-flight-runner.ts) so a slow older snapshot can never overwrite a newer one and no requested id is dropped.
   */

  const patchListRow = useCallback(async (conversationId: string) => {
    const view = viewRef.current;
    const sequence =
      (listPatchSequenceRef.current.get(conversationId) ?? 0) + 1;
    listPatchSequenceRef.current.set(conversationId, sequence);

    const result = await loadInboxConversationListPatchAction({
      conversationId,
      view,
      includeCounts: true,
    });
    // Dropped when the person changed view, or a newer patch for this same chat was started meanwhile.
    if (
      viewRef.current !== view ||
      listPatchSequenceRef.current.get(conversationId) !== sequence
    )
      return;
    if (!result.ok) return;

    const patch = result.data;
    const heldVersion = heldVersionsRef.current.get(conversationId);
    const older = olderChatsRef.current;
    if (older?.conversations.some((chat) => chat.id === conversationId)) {
      const mergedOlder = mergeListPatch({
        conversations: older.conversations,
        hasOlder: older.nextCursor !== null,
        patch,
        heldVersion,
        conversationId,
      });
      if (mergedOlder.changed)
        setOlderChats((current) =>
          current
            ? { ...current, conversations: mergedOlder.conversations }
            : current,
        );
    }

    setListData((current) => {
      if (!current) return current;
      const merged = mergeListPatch({
        conversations: current.conversations,
        // Loaded older pages mean the first page is not the whole view: a row outside its window waits for pagination.
        hasOlder: current.nextCursor !== null || olderChatsRef.current !== null,
        patch,
        heldVersion,
        conversationId,
      });
      if (merged.outcome === "IGNORED_STALE") return current;
      if (merged.version !== undefined)
        heldVersionsRef.current.set(conversationId, merged.version);

      const activeChanged =
        current.activeConversationId === conversationId &&
        patch.conversation !== null;
      const countsChanged = patch.queueCounts !== null;
      if (!merged.changed && !activeChanged && !countsChanged) return current;
      return {
        ...current,
        conversations: merged.changed
          ? merged.conversations
          : current.conversations,
        // The open chat's header follows its row even if it left the view: never yank the person off what they are reading.
        activeConversation: activeChanged
          ? patch.conversation
          : current.activeConversation,
        queueCounts: patch.queueCounts ?? current.queueCounts,
        viewCounts: patch.viewCounts ?? current.viewCounts,
      };
    });
  }, []);

  // The read itself lives in a callback (not inside the runner's constructor) so it may use the refs that mirror screen state.
  const runThreadSync = useCallback(
    async (plan: ThreadSyncPlan) => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;
      if (plan.fullReload) {
        await loadConversationPart(conversationId, true);
        return;
      }
      let messageIds = plan.messageIds;
      for (let page = 0; page < MAX_THREAD_DELTA_PAGES; page += 1) {
        const before = conversationDataRef.current;
        // Still on the initial load: there is nothing to add to yet. Remember to catch up as soon as it lands, because that
        // read may have been taken before this change happened.
        if (!before) {
          catchUpAfterLoadRef.current = true;
          return;
        }
        const result = await loadInboxThreadDeltaAction({
          conversationId,
          afterSequence: highestMessageSequence(before.messages),
          messageIds,
        });
        if (activeConversationIdRef.current !== conversationId) return;
        if (!result.ok) {
          await loadConversationPart(conversationId, true);
          return;
        }
        const latest = conversationDataRef.current;
        if (!latest) return;
        const merged = mergeThreadDelta(latest, result.data);
        if (merged.changed) {
          commitConversationData({
            ...latest,
            messages: merged.messages,
            attachments: merged.attachments,
            mediaAnalyses: merged.mediaAnalyses,
          });
        }
        if (!result.data.hasMore) return;
        messageIds = [];
      }
      // A backlog beyond the page cap: one bounded full read settles it.
      await loadConversationPart(conversationId, true);
    },
    [commitConversationData, loadConversationPart],
  );

  const runNotesSync = useCallback(
    async (plan: NotesSyncPlan) => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;
      let noteIds = plan.noteIds;
      // More notes than one read returns are read page by page from the newest one held; the loop is bounded.
      for (let page = 0; page < MAX_NOTES_DELTA_PAGES; page += 1) {
        const before = conversationDataRef.current;
        if (!before) {
          catchUpAfterLoadRef.current = true;
          return;
        }
        const result = await loadInboxNotesDeltaAction({
          conversationId,
          after: newestNotePosition(before.notes),
          noteIds,
        });
        if (!result.ok || activeConversationIdRef.current !== conversationId)
          return;
        const latest = conversationDataRef.current;
        if (!latest) return;
        const merged = mergeNotesDelta(latest.notes, result.data);
        if (merged.changed)
          commitConversationData({ ...latest, notes: merged.notes });
        if (!result.data.hasMore) return;
        noteIds = [];
      }
      await loadConversationPart(conversationId, true);
    },
    [commitConversationData, loadConversationPart],
  );

  useEffect(() => {
    const runner = createSingleFlightRunner<ThreadSyncPlan>(
      runThreadSync,
      (queued, incoming) => ({
        refetchNewer: queued.refetchNewer || incoming.refetchNewer,
        messageIds: [
          ...new Set([...queued.messageIds, ...incoming.messageIds]),
        ],
        fullReload: queued.fullReload || incoming.fullReload,
      }),
      (cause) => console.error("Inbox thread sync failed", cause),
    );
    threadRunnerRef.current = runner;
    return () => {
      runner.cancelQueued();
      threadRunnerRef.current = null;
    };
  }, [runThreadSync]);

  useEffect(() => {
    const runner = createSingleFlightRunner<NotesSyncPlan>(
      runNotesSync,
      (queued, incoming) => ({
        refetchNewer: queued.refetchNewer || incoming.refetchNewer,
        noteIds: [...new Set([...queued.noteIds, ...incoming.noteIds])],
      }),
      (cause) => console.error("Inbox notes sync failed", cause),
    );
    notesRunnerRef.current = runner;
    return () => {
      runner.cancelQueued();
      notesRunnerRef.current = null;
    };
  }, [runNotesSync]);

  // The composer lease is a snapshot with no ids to lose: the newest read simply wins.
  const syncPresence = useCallback(async () => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    const sequence = ++presenceSyncSequenceRef.current;
    const result = await loadInboxPresenceAction({ conversationId });
    if (
      !result.ok ||
      sequence !== presenceSyncSequenceRef.current ||
      activeConversationIdRef.current !== conversationId
    )
      return;
    const latest = conversationDataRef.current;
    if (!latest) return;
    const held = latest.composerPresence;
    const next = result.data.composerPresence;
    if (held?.staffId === next?.staffId && held?.at === next?.at) return;
    commitConversationData({ ...latest, composerPresence: next });
  }, [commitConversationData]);

  const refreshInboxDialog = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    void loadChatListPart({ conversationId, view: viewRef.current }, false);
    if (conversationId) {
      void loadConversationPart(conversationId, true);
      void loadLeadPart(conversationId, true);
      void loadIntelligencePart(conversationId, true);
    }
  }, [
    loadChatListPart,
    loadConversationPart,
    loadLeadPart,
    loadIntelligencePart,
  ]);

  // A person's own action reads only what it changed (never the whole workspace). Each is safe if the matching realtime
  // event also arrives: the merges are idempotent, and the single-flight runners fold overlapping requests together.
  const syncThreadNow = useCallback(() => {
    threadRunnerRef.current?.submit({
      refetchNewer: true,
      messageIds: [],
      fullReload: false,
    });
  }, []);
  const syncNotesNow = useCallback(() => {
    notesRunnerRef.current?.submit({ refetchNewer: true, noteIds: [] });
  }, []);
  const scopedSync = useMemo<InboxScopedSync>(
    () => ({
      syncThread: syncThreadNow,
      syncNotes: syncNotesNow,
      syncPresence: () => void syncPresence(),
    }),
    [syncNotesNow, syncPresence, syncThreadNow],
  );

  /** Applies one realtime plan: the smallest reads that bring the screen up to date. */
  const applyInboxSyncPlan = useCallback(
    (plan: InboxSyncPlan) => {
      // An event that could not be trusted, a reconnect, or a tab shown again: ONE bounded full reconciliation.
      if (plan.reconcile) {
        refreshInboxDialog();
        return;
      }
      const conversationId = activeConversationIdRef.current;
      if (plan.reloadList) {
        void loadChatListPart({ conversationId, view: viewRef.current }, false);
      } else {
        for (const id of plan.listPatchConversationIds) void patchListRow(id);
      }
      if (plan.thread) threadRunnerRef.current?.submit(plan.thread);
      if (plan.notes) notesRunnerRef.current?.submit(plan.notes);
      if (conversationId && plan.context)
        void loadLeadPart(conversationId, true);
      if (conversationId && plan.intelligence)
        void loadIntelligencePart(conversationId, true);
      if (plan.presence) void syncPresence();
    },
    [
      loadChatListPart,
      loadIntelligencePart,
      loadLeadPart,
      patchListRow,
      refreshInboxDialog,
      syncPresence,
    ],
  );

  // The first page plus any older pages loaded since. The first page wins on a duplicate, because it is the fresher read.
  const visibleListData = useMemo(() => {
    if (!listData || !olderChats) return listData;
    const seen = new Set(listData.conversations.map((chat) => chat.id));
    return {
      ...listData,
      conversations: [
        ...listData.conversations,
        ...olderChats.conversations.filter((chat) => !seen.has(chat.id)),
      ],
      nextCursor: olderChats.nextCursor,
    };
  }, [listData, olderChats]);

  const loadOlderChats = useCallback(async () => {
    const cursor = olderChats
      ? olderChats.nextCursor
      : (listData?.nextCursor ?? null);
    if (!cursor || loadingOlder) return;
    const view = viewRef.current;
    setLoadingOlder(true);
    try {
      const result = await loadInboxListAction({
        conversationId: null,
        view,
        cursor,
      });
      // The person may have switched view while this loaded; those chats no longer belong on screen.
      if (viewRef.current !== view) return;
      if (!result.ok) {
        toast.add({
          title: "Could not load more chats",
          description: result.error,
        });
        return;
      }
      setOlderChats((current) => {
        const known = new Set([
          ...(current?.conversations ?? []).map((chat) => chat.id),
        ]);
        return {
          conversations: [
            ...(current?.conversations ?? []),
            ...result.data.conversations.filter((chat) => !known.has(chat.id)),
          ],
          nextCursor: result.data.nextCursor,
        };
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [listData, loadingOlder, olderChats]);

  const retryConversation = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (conversationId) void loadConversationPart(conversationId, false);
  }, [loadConversationPart]);

  const retryLead = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (conversationId) void loadLeadPart(conversationId, false);
  }, [loadLeadPart]);

  const retryIntelligence = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (conversationId) void loadIntelligencePart(conversationId, false);
  }, [loadIntelligencePart]);

  return listError ? (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
      role="alert"
    >
      <div className="space-y-1">
        <p className="text-base font-medium">Inbox unavailable</p>
        <p className="text-sm text-muted-foreground">{listError}</p>
      </div>
      <Button
        variant="outline_without_border"
        onClick={() =>
          void loadChatListPart(
            {
              conversationId: null,
              view: viewRef.current,
            },
            true,
          )
        }
      >
        Try again
      </Button>
    </div>
  ) : (
    <InboxWorkspaceContent
      data={visibleListData}
      conversationData={conversationData}
      customerContext={leadContext}
      intelligence={intelligence}
      intelligenceError={intelligenceError}
      conversationError={conversationError}
      leadError={leadError}
      onSelectConversation={selectConversation}
      onConversationCreated={openCreatedConversation}
      onSelectView={selectView}
      onRetryConversation={retryConversation}
      onRetryLead={retryLead}
      onRetryIntelligence={retryIntelligence}
      onRefresh={refreshInboxDialog}
      onConversationRemoved={leaveDeletedConversation}
      onSyncPlan={applyInboxSyncPlan}
      scopedSync={scopedSync}
      onLoadOlder={() => void loadOlderChats()}
      loadingOlder={loadingOlder}
      mobileThreadOpen={mobileThreadOpen}
      onMobileBack={closeMobileThread}
    />
  );
}
