"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToneBadge } from "@/components/ui/tone-badge";
import { INTEGRATION_LABELS, INTEGRATION_STATUS_LABELS } from "@/lib/data/settings-copy";
import type { IntegrationConnectionRow } from "@/lib/types/settings";
import type { Tone } from "@/lib/ui/tone";

import { ConnectIntegrationSheet } from "./connect-integration-sheet";

const STATUS_TONE: Record<string, Tone> = {
  NOT_CONNECTED: "neutral",
  CONNECTED: "success",
  MANUAL_WORKFLOW: "info",
  ERROR: "danger",
  DISCONNECTED: "neutral",
};

export function IntegrationCard({
  integration,
  canEdit,
}: {
  integration: IntegrationConnectionRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{INTEGRATION_LABELS[integration.provider]}</span>
        <ToneBadge tone={STATUS_TONE[integration.status]} label={INTEGRATION_STATUS_LABELS[integration.status]} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {integration.connected_account && <span>Connected account: {integration.connected_account}</span>}
        {integration.last_sync_at && (
          <span>Last sync: {formatDistanceToNow(new Date(integration.last_sync_at), { addSuffix: true })}</span>
        )}
        {integration.scopes.length > 0 && <span>Permission scope: {integration.scopes.join(", ")}</span>}
        {integration.notes && <span className="line-clamp-2">Notes: {integration.notes}</span>}
      </div>

      {canEdit && (
        <div className="flex gap-2">
          {integration.status === "CONNECTED" ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Configure
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {integration.status === "MANUAL_WORKFLOW" ? "Configure Notes" : "Connect"}
            </Button>
          )}
        </div>
      )}

      {canEdit && (
        <ConnectIntegrationSheet
          integration={open ? integration : null}
          open={open}
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </Card>
  );
}
