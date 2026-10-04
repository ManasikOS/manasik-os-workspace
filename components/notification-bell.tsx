"use client";

/**
 * The header bar's notification bell — real data, replacing the static
 * hardcoded dot `HeaderBar` used to render. See
 * supabase/migrations/20261001090000_staff_notifications.sql for why this
 * exists: a Copilot proposal queue nobody is told about is a queue nobody
 * reads.
 *
 * Every notification today is Manasik Copilot's own work (a proposal
 * waiting on a decision), so — per docs/standards/copilot-attribution-convention.md —
 * each row is allowed the Sparkles mark; a future system-only notification
 * kind (if one ever ships) should render without it.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell, MessageCircle, Sparkles } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopilotAvatar } from "@/components/ui/copilot-mark";
import { cn } from "@/lib/utils";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/(main)/notifications-actions";
import { relativeTimestamp } from "@/app/(main)/departure-groups/utils";
import type { StaffNotificationRow } from "@/lib/data/staff-notifications";
import { openInboxConversation } from "@/lib/inbox/open-inbox-event";

/** Where a proposal notification leads: its group, or the approvals list. A waiting customer opens the Inbox dialog instead (no URL). */
function notificationHref(n: StaffNotificationRow): string {
  return n.departureGroupId ? `/departure-groups/${n.departureGroupId}?tab=agent` : "/operations/approvals";
}

export default function NotificationBell({
  initialUnreadCount,
  initialNotifications,
}: {
  initialUnreadCount: number;
  initialNotifications: StaffNotificationRow[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();
  const [popoverOpen, setPopoverOpen] = useState(false);

  function markOneRead(id: string) {
    setNotifications((rows) => rows.map((r) => (r.id === id && !r.readAt ? { ...r, readAt: new Date().toISOString() } : r)));
    setUnreadCount((n) => Math.max(0, n - 1));
    startTransition(() => {
      markNotificationReadAction(id);
    });
  }

  function markAllRead() {
    if (unreadCount === 0) return;
    setNotifications((rows) => rows.map((r) => (r.readAt ? r : { ...r, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    startTransition(() => {
      markAllNotificationsReadAction();
    });
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        className="relative size-8.5 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="Notifications"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-medium leading-3.5 text-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 gap-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
            <Sparkles className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Nothing yet — customers waiting for a reply and decisions Manasik Copilot needs will show up here.</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto custom-scroll flex flex-col">
            {notifications.map((n) => {
              const rowClassName = cn(
                "flex w-full items-start gap-2.5 px-3 py-2.5 text-left border-b border-border/40 last:border-b-0 hover:bg-muted/50 transition-colors",
                !n.readAt && "bg-primary/5",
              );
              const rowContent = (
                <>
                {n.conversationId ? (
                  <span className="mt-0.5 size-6 shrink-0 rounded-full bg-muted inline-flex items-center justify-center text-muted-foreground">
                    <MessageCircle className="size-3.5" />
                  </span>
                ) : (
                  <CopilotAvatar className="mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{n.title}</p>
                  {n.groupName && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {n.groupName} ({n.groupCode})
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">{relativeTimestamp(n.createdAt)}</p>
                </div>
                {!n.readAt && <span className="size-1.5 rounded-full bg-primary shrink-0 mt-1.5" />}
                </>
              );

              const conversationId = n.conversationId;
              return conversationId ? (
                <button
                  key={n.id}
                  type="button"
                  className={rowClassName}
                  onClick={() => {
                    markOneRead(n.id);
                    setPopoverOpen(false);
                    openInboxConversation(conversationId);
                  }}
                >
                  {rowContent}
                </button>
              ) : (
                <Link key={n.id} href={notificationHref(n)} onClick={() => markOneRead(n.id)} className={rowClassName}>
                  {rowContent}
                </Link>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
