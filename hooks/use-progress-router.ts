"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { isSameLocation, startRouteProgress } from "@/lib/route-progress";

/**
 * Drop-in replacement for `useRouter()` from `next/navigation` that starts the
 * top progress bar for `push`, `replace`, `back` and `forward`, so navigation
 * started from code gives the same instant feedback as a link click.
 *
 * `refresh` and `prefetch` are passed through untouched — a refresh keeps the
 * same URL, so nothing would ever tell the bar to finish.
 */
export function useProgressRouter() {
  const router = useRouter();

  return useMemo(
    () => ({
      ...router,
      push(...args: Parameters<typeof router.push>) {
        if (!isSameLocation(args[0])) startRouteProgress();
        router.push(...args);
      },
      replace(...args: Parameters<typeof router.replace>) {
        if (!isSameLocation(args[0])) startRouteProgress();
        router.replace(...args);
      },
      back() {
        startRouteProgress();
        router.back();
      },
      forward() {
        startRouteProgress();
        router.forward();
      },
    }),
    [router],
  );
}
