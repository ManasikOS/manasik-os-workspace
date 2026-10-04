"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  finishRouteProgress,
  isSameLocation,
  startRouteProgress,
} from "@/lib/route-progress";

/**
 * Thin top progress bar for every in-app navigation. It replaces the old
 * full-screen loading overlay, which hid the page's own skeleton and only
 * reacted to sidebar links.
 *
 * Starts on any same-origin link click and on back/forward; code-driven
 * navigation starts it through `useProgressRouter`. It finishes when the
 * pathname or search params change.
 */
export default function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (isSameLocation(url)) return;

      startRouteProgress();
    };

    const handleBackForward = () => startRouteProgress();

    document.addEventListener("click", handleLinkClick, true);
    window.addEventListener("popstate", handleBackForward);
    return () => {
      document.removeEventListener("click", handleLinkClick, true);
      window.removeEventListener("popstate", handleBackForward);
    };
  }, []);

  useEffect(() => {
    finishRouteProgress();
  }, [pathname, searchParams]);

  return null;
}
