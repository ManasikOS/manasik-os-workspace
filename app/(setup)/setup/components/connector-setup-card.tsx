import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ConnectorCardState } from "@/lib/setup/connector-card-state";
import type { SetupConnectorCopy } from "@/lib/setup/connector-copy";

const STATE_BADGE: Record<ConnectorCardState, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  NOT_CONNECTED: { label: "Not connected", variant: "outline" },
  CONNECTING: { label: "Connecting…", variant: "secondary" },
  CONNECTED: { label: "Connected", variant: "default" },
  NEEDS_ATTENTION: { label: "Needs attention", variant: "destructive" },
  UNAVAILABLE: { label: "Not available yet", variant: "secondary" },
};

interface ConnectorSetupCardProps {
  copy: SetupConnectorCopy;
  state: ConnectorCardState;
  /** Connected account name or number. */
  accountLabel: string | null;
  /** Why it needs attention, in the provider's words (already length-limited upstream). */
  reason: string | null;
  /** Where "Connect" goes. Omitted for cards with their own inline form. */
  connectHref: string | null;
  /** Inline content, e.g. the email form. */
  children?: ReactNode;
}

/**
 * One connector, in one of five honest states. An unavailable connector has no
 * button at all; a broken one names the reason and offers a retry.
 */
export function ConnectorSetupCard({ copy, state, accountLabel, reason, connectHref, children }: ConnectorSetupCardProps) {
  const badge = STATE_BADGE[state];
  const canStart = connectHref !== null && (state === "NOT_CONNECTED" || state === "NEEDS_ATTENTION");

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{copy.title}</h3>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <p className="text-sm text-muted-foreground">{copy.benefit}</p>

      {state === "CONNECTED" && accountLabel && <p className="text-sm text-foreground">Connected as {accountLabel}.</p>}
      {state === "CONNECTING" && (
        <p className="text-sm text-muted-foreground">This connection is still being set up. Check back in a few minutes.</p>
      )}
      {state === "NEEDS_ATTENTION" && (
        <p role="alert" className="text-sm text-destructive">
          {reason || "This connection has a problem and needs to be connected again."}
        </p>
      )}
      {state === "UNAVAILABLE" && (
        <p className="text-sm text-muted-foreground">
          This connection isn&apos;t available on your workspace yet. You can set it up later once it is.
        </p>
      )}

      {(state === "NOT_CONNECTED" || state === "NEEDS_ATTENTION") && (
        <p className="text-xs text-muted-foreground">
          You&apos;ll need: {copy.needs} {copy.time}.
        </p>
      )}

      {canStart && (
        <Button
          className="self-start"
          variant={state === "NEEDS_ATTENTION" ? "outline" : "default"}
          render={<a href={connectHref} />}
        >
          {state === "NEEDS_ATTENTION" ? "Try again" : `Connect ${copy.title}`}
        </Button>
      )}

      {state === "CONNECTED" && connectHref && (
        <Button className="self-start" variant="outline" render={<Link href="/management/settings/integrations" />}>
          Manage in settings
        </Button>
      )}

      {children}
    </Card>
  );
}
