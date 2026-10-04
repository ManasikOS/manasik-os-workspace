"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  inboxLayoutBudget,
  inboxViewportTier,
  type InboxLayoutBudget,
  type InboxPanelChoice,
  type InboxRailChoice,
  type InboxViewportTier,
} from "@/lib/inbox/inbox-layout-budget";

const RAIL_CHOICE_KEY = "inbox:rail";
const PANEL_CHOICE_KEY = "inbox:customer-panel";
const CHOICE_CHANGED_EVENT = "inbox-layout-choice-changed";

// Kept in memory as well, so the toggles still work for this visit when storage is blocked (private window, cleared site data).
const choicesThisVisit = new Map<string, string>();

function readChoice(key: string): string | null {
  const remembered = choicesThisVisit.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeChoice(key: string, value: string) {
  choicesThisVisit.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice then lasts until reload, which is acceptable.
  }
  window.dispatchEvent(new Event(CHOICE_CHANGED_EVENT));
}

function subscribeToLayoutInputs(notify: () => void) {
  window.addEventListener("resize", notify);
  window.addEventListener("storage", notify);
  window.addEventListener(CHOICE_CHANGED_EVENT, notify);
  return () => {
    window.removeEventListener("resize", notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHOICE_CHANGED_EVENT, notify);
  };
}

// One string snapshot keeps React from re-rendering on every pixel of a resize: it changes only when the tier or a choice does.
function readLayoutSnapshot(): string {
  return [
    inboxViewportTier(window.innerWidth),
    readChoice(RAIL_CHOICE_KEY) ?? "",
    readChoice(PANEL_CHOICE_KEY) ?? "",
  ].join("|");
}

const SERVER_LAYOUT_SNAPSHOT = "narrow||";

export type InboxLayoutControls = InboxLayoutBudget & {
  tier: InboxViewportTier;
  setRailCollapsed: (collapsed: boolean) => void;
  setPanelOpen: (open: boolean) => void;
};

/** The Inbox's pane widths for this screen, with the person's remembered rail and panel choices applied. */
export function useInboxLayoutBudget(): InboxLayoutControls {
  const snapshot = useSyncExternalStore(
    subscribeToLayoutInputs,
    readLayoutSnapshot,
    () => SERVER_LAYOUT_SNAPSHOT,
  );
  const [tier, rail, panel] = snapshot.split("|");
  const budget = inboxLayoutBudget({
    tier: tier as InboxViewportTier,
    railChoice: rail === "expanded" || rail === "collapsed" ? (rail as InboxRailChoice) : null,
    panelChoice: panel === "open" || panel === "closed" ? (panel as InboxPanelChoice) : null,
  });
  const setRailCollapsed = useCallback(
    (collapsed: boolean) => writeChoice(RAIL_CHOICE_KEY, collapsed ? "collapsed" : "expanded"),
    [],
  );
  const setPanelOpen = useCallback(
    (open: boolean) => writeChoice(PANEL_CHOICE_KEY, open ? "open" : "closed"),
    [],
  );
  return { ...budget, tier: tier as InboxViewportTier, setRailCollapsed, setPanelOpen };
}
