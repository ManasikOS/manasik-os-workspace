"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { emptyViewCopy } from "@/lib/inbox/empty-view-copy";
import { channelLabelOf } from "@/lib/inbox/intelligence/rail-view";
import type { InboxView } from "@/lib/inbox/views";
import { nextBestActionFromIntelligence } from "@/lib/inbox/next-best-action";

import type {
  InboxConversation,
  InboxConversationData,
  InboxCustomerContext,
  InboxIntelligenceData,
  InboxListData,
} from "../types";
import ConversationList from "./conversation-list";
import ConversationPanel from "./conversation-panel";
import CustomerContextPanel from "./customer-context-panel";
import InboxCollapsibleLayout from "./inbox-collapsible-layout";
import type { InboxSyncPlan } from "@/lib/inbox/realtime/inbox-sync-plan";
import InboxRealtime from "./inbox-realtime";
import {
  InboxConversationRemovedProvider,
  InboxRefreshProvider,
  InboxScopedSyncProvider,
  type InboxScopedSync,
} from "./inbox-refresh-context";
import {
  ConversationListSkeleton,
  ConversationThreadSkeleton,
  LeadContextSkeleton,
} from "./inbox-section-skeletons";
import InboxViewRail from "./inbox-view-rail";
import { InboxCompactQueueBar } from "./inbox-compact-queue-bar";
import { InboxShortcutProvider } from "./inbox-shortcut-provider";

/**
 * The Inbox arrives in three pieces, so each prop may still be `null` while
 * its piece loads: `data` (chat list), then `conversationData` (messages),
 * then `customerContext` (lead), with `intelligence` (Copilot's reading) loading alongside it. The rail is static and always renders.
 */
export function InboxWorkspaceContent({
  data,
  conversationData,
  customerContext,
  intelligence = null,
  intelligenceError = null,
  conversationError = null,
  leadError = null,
  onSelectConversation,
  onConversationCreated,
  onSelectView,
  onRetryConversation,
  onRetryLead,
  onRetryIntelligence,
  onRefresh,
  onConversationRemoved,
  onSyncPlan,
  scopedSync,
  onLoadOlder,
  loadingOlder = false,
  mobileThreadOpen,
  onMobileBack,
}: {
  /** Below md the screen shows either the list or the open chat; true shows the chat. */
  mobileThreadOpen: boolean;
  onMobileBack: () => void;
  data: InboxListData | null;
  conversationData: InboxConversationData | null;
  customerContext: InboxCustomerContext | null;
  /** Fourth piece: Copilot's stored reading. `null` while it loads; it never blocks the other three. */
  intelligence?: InboxIntelligenceData | null;
  intelligenceError?: string | null;
  conversationError?: string | null;
  leadError?: string | null;
  onSelectConversation: (
    conversationId: string,
    conversation?: InboxConversation,
  ) => void;
  onConversationCreated: (conversationId: string) => void;
  onSelectView: (view: InboxView) => void;
  onRetryConversation: () => void;
  onRetryLead: () => void;
  onRetryIntelligence?: () => void;
  /** Reloads the dialog. Called after an action the person takes inside it (their own actions never wait on realtime). */
  onRefresh: () => void;
  /** Called after staff delete the open conversation: moves the screen off it instead of reloading a chat that is gone. */
  onConversationRemoved: () => void;
  /** Applies one plan of scoped reads for a burst of realtime events — patches and deltas, never a workspace reload. */
  onSyncPlan: (plan: InboxSyncPlan) => void;
  /** The narrow reads a person's own send, note or composer claim needs, so they never trigger a full refresh. */
  scopedSync: InboxScopedSync;
  /** Loads the next page of the open view; only offered while the list has a next-page cursor. */
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
}) {
  const activeConversation = data?.activeConversation ?? null;
  const nextAction = nextBestActionFromIntelligence(intelligence);

  return (
    <InboxRefreshProvider value={onRefresh}>
      <InboxConversationRemovedProvider value={onConversationRemoved}>
      <InboxScopedSyncProvider value={scopedSync}>
        <InboxShortcutProvider>
          <Card className="flex h-full flex-row overflow-hidden bg-card p-0 backdrop-blur-none transition-none **:data-[slot=card]:backdrop-blur-none **:data-[slot=card]:transition-none">
            <InboxRealtime
              agencyId={data?.agencyId ?? null}
              activeConversationId={data?.activeConversationId ?? null}
              onPlan={onSyncPlan}
            />
            <InboxCollapsibleLayout
              mobileThreadOpen={mobileThreadOpen}
              onMobileBack={onMobileBack}
              compactBar={
                <InboxCompactQueueBar
                  viewCounts={data?.viewCounts ?? null}
                  activeView={data?.activeView ?? "all"}
                  queuesV2={data?.queuesV2 ?? false}
                  templates={data?.templates ?? []}
                  canStartChat={data?.capabilities.sendMessage ?? false}
                  emailMailboxReady={data?.emailMailboxReady ?? false}
                  onSelectView={onSelectView}
                  onConversationCreated={onConversationCreated}
                />
              }
              rail={({ collapsed, onToggleCollapsed }) => (
                <InboxViewRail
                  // Server aggregates across the whole agency, kept current by the realtime list patches.
                  viewCounts={data?.viewCounts ?? null}
                  activeView={data?.activeView ?? "all"}
                  templates={data?.templates ?? []}
                  canStartChat={data?.capabilities.sendMessage ?? false}
                  emailMailboxReady={data?.emailMailboxReady ?? false}
                  collapsed={collapsed}
                  onToggleCollapsed={onToggleCollapsed}
                  queuesV2={data?.queuesV2 ?? false}
                  onSelectView={onSelectView}
                  onConversationCreated={onConversationCreated}
                />
              )}
              list={
                data ? (
                  <ConversationList
                    conversations={data.conversations}
                    activeId={data.activeConversationId}
                    activeView={data.activeView}
                    totalInView={data.viewCounts?.[data.activeView] ?? null}
                    currentStaffId={data.staffId}
                    onSelectConversation={onSelectConversation}
                    hasOlder={data.nextCursor !== null}
                    loadingOlder={loadingOlder}
                    onLoadOlder={onLoadOlder}
                    onSelectView={onSelectView}
                    assignableStaff={conversationData?.mentionableStaff ?? []}
                    canBulkAssign={data.capabilities.assignConversation}
                    canBulkClose={data.capabilities.closeConversation}
                    templates={data?.templates ?? []}
                    canStartChat={data?.capabilities.sendMessage ?? false}
                    emailMailboxReady={data?.emailMailboxReady ?? false}
                    onConversationCreated={onConversationCreated}
                  />
                ) : (
                  <ConversationListSkeleton />
                )
              }
              workspace={(leadPanelToggle) => {
                if (!data) {
                  return (
                    <div className="flex h-full flex-col">
                      <ConversationThreadSkeleton />
                    </div>
                  );
                }
                if (!activeConversation) {
                  return (
                    <div
                      className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
                      role="status"
                    >
                      <p className="text-base font-medium">
                        {emptyViewCopy(data.activeView).title}
                      </p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {emptyViewCopy(data.activeView).hint}
                      </p>
                    </div>
                  );
                }
                return (
                  <ConversationPanel
                    conversation={activeConversation}
                    messages={conversationData?.messages ?? []}
                    attachments={conversationData?.attachments ?? []}
                    mediaAnalyses={conversationData?.mediaAnalyses ?? []}
                    notes={conversationData?.notes ?? []}
                    savedReplies={conversationData?.savedReplies ?? []}
                    templates={data.templates}
                    mentionableStaff={conversationData?.mentionableStaff ?? []}
                    draft={conversationData?.draft ?? ""}
                    composerPresence={
                      conversationData?.composerPresence ?? null
                    }
                    composerStaffId={data.staffId}
                    capabilities={data.capabilities}
                    canUseCopilot={data.canUseCopilot}
                    nextAction={nextAction}
                    leadPanelToggle={leadPanelToggle}
                    isLoading={!conversationData}
                    loadError={conversationData ? null : conversationError}
                    onRetryLoad={onRetryConversation}
                  />
                );
              }}
              context={() =>
                !data || activeConversation ? (
                  customerContext && activeConversation ? (
                    <CustomerContextPanel
                      context={customerContext}
                      conversationId={activeConversation.id}
                      intelligence={intelligence}
                      intelligenceError={intelligenceError}
                      channelLabel={channelLabelOf(activeConversation.channel)}
                      onRetryIntelligence={onRetryIntelligence}
                      historyRef={{
                        startedAt: activeConversation.created_at,
                        version: activeConversation.updated_at,
                      }}
                      nextAction={nextAction}
                    />
                  ) : leadError ? (
                    <div
                      role="alert"
                      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
                    >
                      <p className="text-sm text-muted-foreground">
                        {leadError}
                      </p>
                      <Button
                        variant="outline_without_border"
                        size="sm"
                        onClick={onRetryLead}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <LeadContextSkeleton />
                  )
                ) : null
              }
            />
          </Card>
        </InboxShortcutProvider>
      </InboxScopedSyncProvider>
      </InboxConversationRemovedProvider>
    </InboxRefreshProvider>
  );
}
