"use client";

import { useCallback, useEffect, useRef } from "react";

import { useProgressRouter } from "@/hooks/use-progress-router";

import { getLeavingLinkTarget } from "./unsaved-changes-link-click";

/** A way out of the page that was stopped because there are unsaved edits. */
export type BlockedNavigation = { kind: "link"; href: string } | { kind: "back" };

interface UseUnsavedChangesGuardParams {
  isDirty: boolean;
  /** Called when a link click or the Back button was stopped. Show the "unsaved changes" prompt. */
  onBlocked: (blocked: BlockedNavigation) => void;
}

/**
 * Stops the page being left by accident while there are unsaved edits.
 *
 * - Closing the tab or reloading: the browser's own prompt (`beforeunload`).
 * - Clicking a link to another page in the app: stopped, then `onBlocked`.
 * - The browser Back button: stopped, then `onBlocked`.
 *
 * The App Router has no "route is about to change" event, so the last two are
 * done by listening for the click and `popstate` ourselves. The `popstate`
 * listener runs in the capture phase so it sees the event before Next's own
 * handler, which we then keep from running. If that ever stops being true, Back
 * simply leaves without asking, as it did before this guard existed.
 *
 * Navigation started from code (`router.push`) is not intercepted — the caller
 * decides when that is safe.
 */
export function useUnsavedChangesGuard({ isDirty, onBlocked }: UseUnsavedChangesGuardParams) {
  const router = useProgressRouter();

  // Always the latest callback, without re-adding the listeners on every render.
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  });

  // Set once the person has chosen to leave, so our own navigation is not stopped again.
  const isLeavingRef = useRef(false);
  // Set while we undo a Back press ourselves, so that second `popstate` is not mistaken for a new one.
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if (!isDirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isLeavingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const stopLeavingLink = (event: MouseEvent) => {
      if (isLeavingRef.current || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = getLeavingLinkTarget({
        click: event,
        link: { href: anchor.href, target: anchor.target, hasDownload: anchor.hasAttribute("download") },
        currentHref: window.location.href,
      });
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();
      onBlockedRef.current({ kind: "link", href });
    };

    const stopBackButton = (event: PopStateEvent) => {
      if (isLeavingRef.current) return;
      // Keep Next from navigating: the page stays on screen, only the address bar moved.
      event.stopImmediatePropagation();
      if (isRestoringRef.current) {
        isRestoringRef.current = false;
        return;
      }
      // Put the address bar back where it was, then ask.
      isRestoringRef.current = true;
      window.history.go(1);
      onBlockedRef.current({ kind: "back" });
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", stopLeavingLink, true);
    window.addEventListener("popstate", stopBackButton, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", stopLeavingLink, true);
      window.removeEventListener("popstate", stopBackButton, true);
    };
  }, [isDirty]);

  /** Carries on to where the person was going, now that they have chosen to leave. */
  const leave = useCallback(
    (blocked: BlockedNavigation) => {
      isLeavingRef.current = true;
      if (blocked.kind === "back") window.history.back();
      else router.push(blocked.href);
    },
    [router],
  );

  return { leave };
}
