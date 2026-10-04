"use client";

import {
  ArrowLeft,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import type { InboxView } from "@/lib/inbox/views";
import InboxLogo from "@/public/logos/inbox-logo.svg";
import type { InboxTemplate } from "../types";
import { InboxOutcomeMetricsDialog } from "./inbox-outcome-metrics";
import { useInboxShortcuts } from "./inbox-shortcut-provider";
import { InboxViewNavigation } from "./inbox-view-navigation";
import Image from "next/image";

/** The widths the layout budget (`lib/inbox/inbox-layout-budget.ts`) counts on: 216px open, 48px folded to icons. */
const INBOX_RAIL_SIDEBAR_STYLE = {
  "--sidebar-width": "13.5rem",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

function InboxRailCollapseButton() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={collapsed ? "Expand inbox menu" : "Collapse inbox menu"}
        aria-expanded={!collapsed}
        onClick={toggleSidebar}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden="true" />
        ) : (
          <PanelLeftClose aria-hidden="true" />
        )}
        <span>{collapsed ? "Expand menu" : "Collapse menu"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The Inbox's own sidebar: the shadcn Sidebar in icon-collapsible mode, so folding it shows icons only and never half-clipped text. */
export default function InboxViewRail({
  viewCounts,
  activeView,
  queuesV2 = false,
  collapsed = false,
  onToggleCollapsed,
  onSelectView,
}: {
  /**
   * How many open conversations each view holds across the whole agency (server aggregates, not the loaded page).
   * Null while the chat list is still loading, so no count is shown rather than a wrong one.
   */
  viewCounts: Record<InboxView, number> | null;
  activeView: InboxView;
  templates: InboxTemplate[];
  canStartChat: boolean;
  emailMailboxReady: boolean;
  /** True when this agency uses the grouped queue rail (agency_settings.inbox_queues_v2). */
  queuesV2?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSelectView: (view: InboxView) => void;
  onConversationCreated: (conversationId: string) => void;
}) {
  const { openHelp } = useInboxShortcuts();
  return (
    <SidebarProvider
      open={!collapsed}
      // The page owns the choice (and remembers it); the Inbox must not overwrite the CRM sidebar's saved state.
      persistState={false}
      onOpenChange={(open) => {
        if (open === collapsed) onToggleCollapsed?.();
      }}
      style={INBOX_RAIL_SIDEBAR_STYLE}
      className="h-full min-h-0 w-auto"
    >
      <Sidebar
        collapsible="icon"
        aria-label="Inbox views"
        className="h-full border-r border-muted/60"
      >
        <SidebarHeader className="gap-3 p-2">
          <Image
            src={InboxLogo}
            alt="Manasik Inbox"
            className="dark:invert"
            width={100}
            height={100}
          />
        </SidebarHeader>
        <SidebarContent className="gap-0">
          <InboxViewNavigation
            viewCounts={viewCounts}
            activeView={activeView}
            queuesV2={queuesV2}
            onSelectView={onSelectView}
          />
        </SidebarContent>
        <SidebarFooter className="p-2">
          <SidebarMenu>
            <InboxRailCollapseButton />
            {/* The Inbox opens in its own tab without the CRM's sidebar, so keep a way back into the CRM. */}

            <SidebarMenuItem>
              <InboxOutcomeMetricsDialog onOpenQueueView={onSelectView} />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Keyboard shortcuts (?)"
                aria-keyshortcuts="?"
                onClick={openHelp}
              >
                <Keyboard aria-hidden="true" />
                <span>Keyboard shortcuts</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Back to the CRM"
                render={<a href="/dashboard" />}
              >
                <ArrowLeft aria-hidden="true" />
                <span>Back to the CRM</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
