"use client";

/**
 * Meta Ads connect card — a real OAuth redirect (unlike WhatsApp's
 * Embedded-Signup popup, standard ad-platform OAuth just redirects the
 * whole page to the provider and back). The "Connect" link points at
 * `/api/oauth/meta-ads/start`, a Route Handler that sets a CSRF state
 * cookie and 302s to Meta — see that route's doc comment. This card never
 * talks to Meta directly; it only renders stored connection state and
 * calls `disconnectMetaAdsAction` on disconnect.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";

import { disconnectMetaAdsAction } from "./ads-actions";

const STATUS_TONE: Record<string, Tone> = {
  NOT_CONNECTED: "neutral",
  CONNECTED: "success",
  ERROR: "danger",
  DISCONNECTED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  NOT_CONNECTED: "Not connected",
  CONNECTED: "Connected",
  ERROR: "Error",
  DISCONNECTED: "Disconnected",
};

export function MetaAdsConnectCard({
  status,
  adAccountName,
  adAccountId,
  tokenExpiresAt,
  lastSyncedAt,
  lastError,
  configured,
  canEdit,
}: {
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR" | "DISCONNECTED";
  adAccountName: string | null;
  adAccountId: string | null;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** False when META_ADS_APP_ID isn't set on this deployment — the button explains why instead of failing silently. */
  configured: boolean;
  canEdit: boolean;
}) {
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    setDisconnecting(true);
    const result = await disconnectMetaAdsAction();
    setDisconnecting(false);
    if (!result.ok) {
      toast.add({ title: "Could not disconnect", description: result.error });
      return;
    }
    toast.add({ title: "Meta Ads disconnected" });
  };

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Meta Ads</span>
        <ToneBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {adAccountName && <span>Ad account: {adAccountName} {adAccountId && `(${adAccountId})`}</span>}
        {tokenExpiresAt && <span>Token expires: {new Date(tokenExpiresAt).toLocaleDateString()}</span>}
        {lastSyncedAt && <span>Last spend sync: {new Date(lastSyncedAt).toLocaleString()}</span>}
        {lastError && <span className="text-destructive">{lastError}</span>}
        {!configured && (
          <span>Set META_ADS_APP_ID / META_ADS_APP_SECRET (and get Meta to approve ads_read) to enable this connection.</span>
        )}
      </div>

      {canEdit && (
        <div className="flex gap-2">
          {status === "CONNECTED" ? (
            <Button variant="secondary" size="sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : configured ? (
            <Button variant="outline" size="sm" render={<a href="/api/oauth/meta-ads/start" />}>
              Connect with Meta
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.add({
                  title: "Meta Ads is not set up on this server yet",
                  description: "Add META_ADS_APP_ID and META_ADS_APP_SECRET in Vercel, from a Meta app with the Marketing API product (separate from your WhatsApp app), then redeploy.",
                })
              }
            >
              Connect with Meta
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
