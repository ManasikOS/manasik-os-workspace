"use client";

import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";

import { Card } from "@/components/ui/card";

/**
 * What a block shows in place of itself when its data could not be read
 * (`DashboardData.blockErrors`) or it threw while rendering. Deliberately
 * quiet — one muted card, not a page-level failure — so a single bad read
 * does not take the landing page down with it
 * (docs/modules/dashboard-role-blocks-spec.md G6).
 */
export function BlockErrorCard({ label }: { label: string }) {
  return (
    <Card role="alert" className="flex h-full flex-col items-start gap-2 border-destructive/20 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="size-4 text-destructive" aria-hidden />
        {label}
      </div>
      <p className="text-sm text-muted-foreground">
        This section couldn&apos;t be loaded. The rest of your dashboard is unaffected — refresh the page to try again.
      </p>
    </Card>
  );
}

/**
 * Catches a block that throws while rendering so its siblings still render.
 * (A *data* failure never gets here: the repository marks it in
 * `blockErrors` and the page substitutes `BlockErrorCard` directly.)
 */
export default class BlockBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[dashboard] the "${this.props.label}" block failed to render:`, error);
    Sentry.captureException(error, { tags: { boundary: `dashboard.${this.props.label}` } });
  }

  render() {
    return this.state.failed ? <BlockErrorCard label={this.props.label} /> : this.props.children;
  }
}
