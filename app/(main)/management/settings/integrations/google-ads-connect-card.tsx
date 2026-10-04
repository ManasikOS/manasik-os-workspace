"use client";

/**
 * Google Ads connect card — same OAuth-redirect posture as
 * `meta-ads-connect-card.tsx`; see that file's doc comment.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";

import { disconnectGoogleAdsAction } from "./ads-actions";

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

export function GoogleAdsConnectCard({
  status,
  accountName,
  customerId,
  lastSyncedAt,
  lastError,
  configured,
  canEdit,
}: {
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR" | "DISCONNECTED";
  accountName: string | null;
  customerId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** False when GOOGLE_ADS_CLIENT_ID/DEVELOPER_TOKEN isn't set on this deployment. */
  configured: boolean;
  canEdit: boolean;
}) {
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    setDisconnecting(true);
    const result = await disconnectGoogleAdsAction();
    setDisconnecting(false);
    if (!result.ok) {
      toast.add({ title: "Could not disconnect", description: result.error });
      return;
    }
    toast.add({ title: "Google Ads disconnected" });
  };

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Google Ads</span>
        <ToneBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {customerId && <span>Customer account: {accountName ?? customerId}</span>}
        {lastSyncedAt && <span>Last spend sync: {new Date(lastSyncedAt).toLocaleString()}</span>}
        {lastError && <span className="text-destructive">{lastError}</span>}
        {!configured && (
          <span>Set GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN to enable this connection.</span>
        )}
      </div>

      {canEdit && (
        <div className="flex gap-2">
          {status === "CONNECTED" ? (
            <Button variant="secondary" size="sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : configured ? (
            <Button variant="outline" size="sm" render={<a href="/api/oauth/google-ads/start" />}>
              Connect with Google
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.add({
                  title: "Google Ads is not set up on this server yet",
                  description: "Add GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_DEVELOPER_TOKEN in Vercel, then redeploy.",
                })
              }
            >
              Connect with Google
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
