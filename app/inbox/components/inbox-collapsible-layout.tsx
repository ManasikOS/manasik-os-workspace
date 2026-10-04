"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useInboxLayoutBudget } from "./use-inbox-layout-budget";

/**
 * Widths are fixed on purpose: nothing in the Inbox is drag-resizable. The
 * view rail and the lead panel each collapse and expand with a short width
 * transition. Their inner content keeps its full width while the outer box
 * animates, so text never re-wraps mid-transition.
 *
 * Which panes are open at a given screen width, and what the person chose last,
 * comes from `useInboxLayoutBudget`: the open conversation keeps its room, so
 * the customer panel docks beside the chat from 1280px (a sheet below that)
 * and the queue rail stays folded to icons until 1440px.
 */
const LEAD_PANEL_WIDTH_CLASS = "w-85";

export default function InboxCollapsibleLayout({
  rail,
  compactBar,
  list,
  workspace,
  context,
  mobileThreadOpen,
  onMobileBack,
}: {
  /** Queue switching and "new chat" for screens too narrow for the rail (below lg). */
  compactBar: ReactNode;
  /** Below md only one of the list and the open chat fits: true shows the chat. Wider screens show both. */
  mobileThreadOpen: boolean;
  onMobileBack: () => void;
  rail: (control: {
    collapsed: boolean;
    onToggleCollapsed: () => void;
  }) => ReactNode;
  list: ReactNode;
  workspace: (leadPanelToggle: ReactNode) => ReactNode;
  /** Creates one context panel for either the desktop rail or the mobile Sheet. */
  context: (() => ReactNode) | null;
}) {
  const {
    railCollapsed,
    setRailCollapsed,
    panelDocked: showDesktopContext,
    panelOpen: leadPanelOpen,
    setPanelOpen: setLeadPanelOpen,
  } = useInboxLayoutBudget();
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  // The first paint snaps to the right width; only a click on the toggle animates, so the rail never "slides" on load.
  const [railToggled, setRailToggled] = useState(false);

  const desktopLeadPanelToggle =
    context && showDesktopContext ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                leadPanelOpen
                  ? "Hide customer details"
                  : "Show customer details"
              }
              aria-expanded={leadPanelOpen}
              aria-controls="inbox-lead-panel"
              onClick={() => setLeadPanelOpen(!leadPanelOpen)}
            />
          }
        >
          {leadPanelOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </TooltipTrigger>
        <TooltipContent className={"text-foreground"}>
          {leadPanelOpen ? "Hide customer details" : "Show customer details"}
        </TooltipContent>
      </Tooltip>
    ) : null;

  const mobileLeadPanelToggle =
    context && !showDesktopContext ? (
      <Sheet open={mobileContextOpen} onOpenChange={setMobileContextOpen}>
        <SheetTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Show customer details"
              aria-haspopup="dialog"
            />
          }
        >
          <PanelRightOpen />
        </SheetTrigger>
        <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Customer details</SheetTitle>
            <SheetDescription>
              Lead, booking, follow-up, and conversation actions.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{context()}</div>
        </SheetContent>
      </Sheet>
    ) : null;

  const leadPanelToggle = desktopLeadPanelToggle ?? mobileLeadPanelToggle;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col md:flex-row">
      {/* The Inbox sidebar is the shadcn Sidebar; it animates its own width. The first paint is instant so it never slides on load. */}
      <div
        className={cn(
          "hidden border-r border-muted-foreground/1 shadow-muted-foreground/10 dark:shadow-muted-foreground/2 shadow-sm shrink-0 lg:block",
          !railToggled &&
            "[&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none",
        )}
      >
        {rail({
          collapsed: railCollapsed,
          onToggleCollapsed: () => {
            setRailToggled(true);
            setRailCollapsed(!railCollapsed);
          },
        })}
      </div>
      <div
        className={cn(
          "min-h-0 w-full flex-1 flex-col overflow-hidden border-muted md:w-80 md:flex-none md:border-r",
          mobileThreadOpen ? "hidden md:flex" : "flex",
        )}
      >
        {compactBar}
        <div className="min-h-0 flex-1">{list}</div>
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0  flex-1 flex-col overflow-hidden md:flex md:h-full",
          mobileThreadOpen ? "flex" : "hidden",
        )}
      >
        <div className="flex items-center border-b border-muted px-2 py-1 md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMobileBack}
          >
            <ArrowLeft aria-hidden="true" />
            All chats
          </Button>
        </div>
        <div className="min-h-0 flex-1">{workspace(leadPanelToggle)}</div>
      </div>
      {context && showDesktopContext && (
        <div
          id="inbox-lead-panel"
          aria-hidden={!leadPanelOpen}
          inert={!leadPanelOpen}
          className={cn(
            "shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
            leadPanelOpen
              ? `${LEAD_PANEL_WIDTH_CLASS} border-l border-muted`
              : "w-0",
          )}
        >
          <div className={cn("h-full", LEAD_PANEL_WIDTH_CLASS)}>
            {context()}
          </div>
        </div>
      )}
    </div>
  );
}
