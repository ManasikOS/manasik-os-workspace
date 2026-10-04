import NProgress from "nprogress";

/**
 * Client-only controller for the thin top progress bar. Anything that starts
 * a navigation (link clicks, `router.push`, back/forward) calls
 * `startRouteProgress()`; `RouteProgressBar` calls `finishRouteProgress()` once
 * the URL has actually changed.
 */

/** A navigation that never lands (error, aborted, same URL) must not leave the bar stuck. */
const ROUTE_PROGRESS_SAFETY_MS = 10_000;

let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let navigationStartedAt: number | null = null;
const isNavigationTimingEnabled = process.env.NEXT_PUBLIC_PERF_TIMING === "1";
let isConfigured = false;

function configureRouteProgress() {
  if (isConfigured) return;
  NProgress.configure({ showSpinner: false, minimum: 0.12, trickleSpeed: 140 });
  isConfigured = true;
}

export function startRouteProgress() {
  if (typeof window === "undefined") return;
  configureRouteProgress();
  NProgress.start();
  if (navigationStartedAt === null) navigationStartedAt = performance.now();
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(finishRouteProgress, ROUTE_PROGRESS_SAFETY_MS);
}

export function finishRouteProgress() {
  if (typeof window === "undefined") return;
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (navigationStartedAt !== null && isNavigationTimingEnabled) {
    // Click (or code-driven navigation) to the new URL being committed.
    console.info(`[perf] navigation ${Math.round(performance.now() - navigationStartedAt)}ms -> ${window.location.pathname}`);
  }
  navigationStartedAt = null;
  if (NProgress.isStarted()) NProgress.done();
}

/** True when `href` resolves to the page the user is already on. */
export function isSameLocation(href: string | URL): boolean {
  try {
    const target = new URL(href, window.location.href);
    return (
      target.origin === window.location.origin &&
      target.pathname + target.search === window.location.pathname + window.location.search
    );
  } catch {
    return false;
  }
}
