"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { toast } from "@/components/ui/toast";
import {
  INBOX_SHORTCUTS,
  INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS,
  resolveInboxShortcut,
  type InboxShortcutId,
} from "@/lib/inbox/keyboard-shortcuts";
import { readInboxShortcutContext, runInboxShortcutCommand } from "@/lib/inbox/shortcut-targets";

import { InboxShortcutHelp } from "./inbox-shortcut-help";

/** The conversation list already owns these three; this provider claims everything else. */
const LIST_OWNED: readonly InboxShortcutId[] = ["NEXT_CONVERSATION", "PREVIOUS_CONVERSATION", "FOCUS_SEARCH"];
const PROVIDER_SCOPE: readonly InboxShortcutId[] = INBOX_SHORTCUTS.map((shortcut) => shortcut.id).filter((id) => !LIST_OWNED.includes(id));

interface InboxShortcutControls {
  openHelp: () => void;
  /** Lets a custom panel or overlay take part in Escape. Returns a function that removes it. The newest one closes first. */
  registerTransientSurface: (close: () => void) => () => void;
}

const InboxShortcutContextValue = createContext<InboxShortcutControls>({
  openHelp: () => undefined,
  registerTransientSurface: () => () => undefined,
});

export function useInboxShortcuts(): InboxShortcutControls {
  return useContext(InboxShortcutContextValue);
}

/**
 * Carries out the Inbox keyboard shortcuts. The registry decides what a key means and refuses it while typing, composing
 * or with a modifier held. Each command then presses the visible control that already does the job, so a shortcut can
 * never do more than that control, and an unavailable one says why instead of failing silently.
 */
export function InboxShortcutProvider({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingRef = useRef<{ first: string; at: number } | null>(null);
  const pendingTimer = useRef<number | null>(null);
  const surfacesRef = useRef<Array<() => void>>([]);

  const registerTransientSurface = useCallback((close: () => void) => {
    surfacesRef.current.push(close);
    return () => {
      surfacesRef.current = surfacesRef.current.filter((entry) => entry !== close);
    };
  }, []);

  useEffect(() => {
    const clearPending = () => {
      pendingRef.current = null;
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      // While any dialog is open the keys belong to it; only the help overlay's own Escape needs to work, and it does.
      if (document.querySelector('[role="dialog"]')) return;

      const resolution = resolveInboxShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          isComposing: event.isComposing || event.keyCode === 229,
          target: event.target as HTMLElement | null,
          pending: pendingRef.current,
          now: Date.now(),
        },
        readInboxShortcutContext(document, surfacesRef.current.length),
        PROVIDER_SCOPE,
      );

      if (resolution.kind === "NONE") {
        clearPending();
        return;
      }
      if (resolution.kind === "PENDING") {
        clearPending();
        pendingRef.current = { first: resolution.first, at: resolution.at };
        pendingTimer.current = window.setTimeout(clearPending, INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS);
        return;
      }

      clearPending();
      if (resolution.kind === "UNAVAILABLE") {
        // Escape with nothing open is just Escape; staying quiet there avoids a message on every press.
        if (resolution.id === "CLOSE_TOPMOST") return;
        const shortcut = INBOX_SHORTCUTS.find((entry) => entry.id === resolution.id);
        toast.add({ title: shortcut?.label ?? "Shortcut unavailable", description: resolution.reason });
        return;
      }

      event.preventDefault();
      if (resolution.id === "OPEN_HELP") {
        setHelpOpen(true);
        return;
      }
      if (resolution.id === "CLOSE_TOPMOST") {
        surfacesRef.current[surfacesRef.current.length - 1]?.();
        return;
      }
      runInboxShortcutCommand(resolution.id, document, (callback) => window.requestAnimationFrame(callback));
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearPending();
    };
  }, []);

  const controls = useMemo<InboxShortcutControls>(
    () => ({ openHelp: () => setHelpOpen(true), registerTransientSurface }),
    [registerTransientSurface],
  );

  return (
    <InboxShortcutContextValue.Provider value={controls}>
      {children}
      <InboxShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </InboxShortcutContextValue.Provider>
  );
}
