"use client";

import { useState } from "react";
import {
  AlarmClock,
  Archive,
  BadgeAlert,
  Camera,
  ChevronDown,
  CircleUserRound,
  Clock,
  FileText,
  Flame,
  Inbox,
  Landmark,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareReply,
  Plane,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  railCountLabel,
  railQueueGroups,
  railQueueVisibility,
  type QueueDefinition,
  type QueueIconKey,
} from "@/lib/inbox/queues";
import { queueForView, viewForQueue, type InboxView } from "@/lib/inbox/views";
import WhatsApp from "@/public/source_logos/whatsapp.svg";
import Instagram from "@/public/source_logos/instagram.svg";
import Messenger from "@/public/source_logos/messenger.svg";

export const LEGACY_RAIL_VIEWS: RailNavigationView[] = [
  { id: "all", label: "All conversations", icon: Inbox },
  { id: "unassigned", label: "Unassigned", icon: CircleUserRound },
  { id: "assigned-to-me", label: "Assigned to me", icon: UserRound },
  { id: "whatsapp", label: "WhatsApp", image: WhatsApp },
  { id: "instagram", label: "Instagram", image: Instagram },
  { id: "messenger", label: "Messenger", image: Messenger },
  { id: "email", label: "Email", icon: Mail },
  { id: "closed", label: "Closed", icon: Archive },
  { id: "spam", label: "Spam", icon: ShieldAlert },
];

const QUEUE_ICONS: Record<QueueIconKey, LucideIcon> = {
  inbox: Inbox,
  user: UserRound,
  unassigned: CircleUserRound,
  reply: MessageSquareReply,
  clock: Clock,
  team: Users,
  done: Archive,
  payment: Landmark,
  document: FileText,
  visa: Plane,
  complaint: BadgeAlert,
  escalation: Flame,
  whatsapp: MessageCircle,
  instagram: Camera,
  messenger: MessageSquare,
  email: Mail,
  spam: ShieldAlert,
  sparkles: Sparkles,
  alarm: AlarmClock,
};

const QUEUE_RAIL_GROUPS = railQueueGroups();

export type RailNavigationView = {
  id: InboxView;
  label: string;
  icon?: LucideIcon;
  image?: string;
};

function navigationViewForQueue(
  queue: QueueDefinition,
): RailNavigationView | null {
  const id = viewForQueue(queue.code);
  return id ? { id, label: queue.label, icon: QUEUE_ICONS[queue.icon] } : null;
}

function InboxViewNavigationItem({
  view,
  badge,
  activeView,
  onSelectView,
}: {
  view: RailNavigationView;
  badge: string | null;
  activeView: InboxView;
  onSelectView: (view: InboxView) => void;
}) {
  const Icon = view.icon;
  const selected = activeView === view.id;
  return (
    <SidebarMenuItem className="items-center flex w-full flex-row justify-between">
      <SidebarMenuButton
        isActive={selected}
        tooltip={view.label}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelectView(view.id)}
      >
        {view.image && (
          <Image
            src={view.image}
            width={16}
            height={16}
            alt=""
            aria-hidden="true"
            className="shrink-0"
          />
        )}
        {!view.image && Icon && <Icon aria-hidden="true" />}
        <span>{view.label}</span>
        {badge && (
          <SidebarMenuBadge className="items-cen  ter text-center">
            {badge}
          </SidebarMenuBadge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function InboxViewNavigation({
  viewCounts,
  activeView,
  queuesV2,
  onSelectView,
}: {
  viewCounts: Record<InboxView, number> | null;
  activeView: InboxView;
  queuesV2: boolean;
  onSelectView: (view: InboxView) => void;
}) {
  const [showMoreQueues, setShowMoreQueues] = useState(false);
  const renderViews = (views: RailNavigationView[]) =>
    views.map((view) => (
      <InboxViewNavigationItem
        key={view.id}
        view={view}
        badge={railCountLabel(viewCounts?.[view.id])}
        activeView={activeView}
        onSelectView={onSelectView}
      />
    ));

  if (!queuesV2) {
    return (
      <>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {renderViews(LEGACY_RAIL_VIEWS.slice(0, 3))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Channels</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderViews(LEGACY_RAIL_VIEWS.slice(3, 7))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>{renderViews(LEGACY_RAIL_VIEWS.slice(7))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </>
    );
  }

  return (
    <>
      {railQueueVisibility({
        groups: QUEUE_RAIL_GROUPS,
        countOf: (queue) => viewCounts?.[viewForQueue(queue) ?? "all"] ?? 0,
        activeQueue: queueForView(activeView),
      }).map((group, index) => {
        const shownViews = group.shown.flatMap(
          (queue) => navigationViewForQueue(queue) ?? [],
        );
        const tuckedViews = showMoreQueues
          ? group.tucked.flatMap((queue) => navigationViewForQueue(queue) ?? [])
          : [];
        if (shownViews.length === 0 && tuckedViews.length === 0) return null;
        return (
          <SidebarGroup key={group.group}>
            {/* The first group is the Inbox itself, which the heading above already says. */}
            {index > 0 && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {renderViews([...shownViews, ...tuckedViews])}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-expanded={showMoreQueues}
                onClick={() => setShowMoreQueues((current) => !current)}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={showMoreQueues ? "rotate-180" : undefined}
                />
                <span>{showMoreQueues ? "Fewer queues" : "More queues"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
