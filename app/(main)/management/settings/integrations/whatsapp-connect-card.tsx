"use client";

/**
 * WhatsApp connect: Meta Embedded Signup only. Every agency connects the same way: sign in to Meta, choose (or
 * create) their WhatsApp Business Account and number, approve, and come back connected. There is no manual
 * token, app or webhook setup on the agency's side. See docs/modules/whatsapp-meta-connection-implementation-plan.md
 * and docs/architecture/whatsapp-multi-tenant-connection.md.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  chooseWhatsAppAccount,
  disconnectWhatsApp,
  getWhatsAppChoices,
  testWhatsAppConnection,
  type WhatsAppChoice,
} from "./whatsapp-actions";

import { TONE_TEXT, type Tone } from "@/lib/ui/tone";

export interface WhatsAppConnectCardProps {
  status: "NOT_CONNECTED" | "CONNECTED" | "UNFUNDED" | "ERROR" | "DISCONNECTED" | "PENDING_REVIEW" | "RESTRICTED";
  displayPhoneNumber: string | null;
  businessName: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  fundingStatus: "UNKNOWN" | "FUNDED" | "UNFUNDED" | null;
  tokenExpiresAt: string | null;
  webhookVerifiedAt: string | null;
  onboardingStep: string | null;
  lastError: string | null;
  /** From META_APP_ID on the server; only used to tell staff when the deployment is not configured. */
  appId: string | null;
  /** From META_CONFIG_ID on the server. */
  configId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  NOT_CONNECTED: "Not Connected",
  CONNECTED: "Connected",
  UNFUNDED: "Unfunded",
  ERROR: "Needs Reconnect",
  DISCONNECTED: "Disconnected",
  PENDING_REVIEW: "Pending Review",
  RESTRICTED: "Restricted",
};

/** Meta's `quality_rating` values, colour-coded. */
const QUALITY_TONE: Record<string, Tone> = {
  GREEN: "success",
  YELLOW: "warning",
  RED: "danger",
};

export function WhatsAppConnectCard({
  status,
  displayPhoneNumber,
  businessName,
  qualityRating,
  messagingLimitTier,
  fundingStatus,
  tokenExpiresAt,
  webhookVerifiedAt,
  onboardingStep,
  lastError,
  appId,
  configId,
}: WhatsAppConnectCardProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isDegraded = status === "UNFUNDED" || status === "ERROR" || status === "RESTRICTED" || status === "PENDING_REVIEW";
  const isConnectedish = status === "CONNECTED" || isDegraded;

  // The redirect flow returns here with ?whatsapp=connected|error&message=… (see app/api/oauth/whatsapp/callback).
  const searchParams = useSearchParams();
  const returnedMessage = searchParams.get("whatsapp") ? searchParams.get("message") : null;
  const router = useRouter();

  // A signup that granted several WhatsApp accounts comes back as ?whatsapp=choose; ask which one to connect.
  const needsChoice = searchParams.get("whatsapp") === "choose";
  const [choices, setChoices] = useState<WhatsAppChoice[] | null>(null);
  const [picked, setPicked] = useState<{ wabaId: string; phoneNumberId: string } | null>(null);

  useEffect(() => {
    if (!needsChoice) return;
    let cancelled = false;
    void getWhatsAppChoices().then((found) => {
      if (!cancelled) setChoices(found);
    });
    return () => {
      cancelled = true;
    };
  }, [needsChoice]);

  async function handleChoose() {
    if (!picked) return;
    setBusy(true);
    const result = await chooseWhatsAppAccount(picked);
    setMessage(result.ok ? `Connected: ${result.displayPhoneNumber}` : result.error);
    setBusy(false);
    if (result.ok) {
      setChoices(null);
      router.replace("/management/settings/integrations");
      router.refresh();
    }
  }

  /**
   * Embedded Signup as a full-page redirect to Meta and back, not the Facebook JS SDK popup. The SDK needs
   * connect.facebook.net to load in this browser and extensions or privacy tools block it, leaving the button
   * dead; a normal navigation cannot be blocked that way (Meta's own hosted signup link works in every browser
   * for the same reason).
   */
  function handleConnect() {
    if (!appId || !configId) {
      setMessage(
        `WhatsApp connect is not configured for this deployment (${!appId ? "META_APP_ID" : "META_CONFIG_ID"} is missing from the environment).`,
      );
      return;
    }
    setBusy(true);
    window.location.assign("/api/oauth/whatsapp/start");
  }

  async function handleDisconnect() {
    setBusy(true);
    const result = await disconnectWhatsApp();
    setMessage(result.ok ? "Disconnected." : result.error);
    setBusy(false);
  }

  async function handleTest() {
    setBusy(true);
    const result = await testWhatsAppConnection();
    setMessage(result.ok ? `Connection OK: ${result.displayPhoneNumber}` : result.error);
    setBusy(false);
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">WhatsApp</h3>
          <p className="text-xs text-muted-foreground">
            {isConnectedish && displayPhoneNumber
              ? businessName
                ? `${businessName} · ${displayPhoneNumber}`
                : displayPhoneNumber
              : "Connect your agency's WhatsApp number to receive pilgrim messages directly inside your CRM."}
          </p>
        </div>
        <Badge variant={status === "CONNECTED" ? "default" : isDegraded ? "destructive" : "outline"}>
          {STATUS_LABEL[status] ?? status}
        </Badge>
      </div>

      {(status === "UNFUNDED" || (status === "CONNECTED" && fundingStatus === "UNFUNDED")) && (
        <p className={`text-xs ${TONE_TEXT.warning}`}>
          No payment method is on file in WhatsApp Manager — messages will not send until one is added. Meta bills
          your agency directly for WhatsApp usage.{" "}
          <a
            href="https://business.facebook.com/wa/manage/payment-methods/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Add a payment method in WhatsApp Manager
          </a>
          .
        </p>
      )}
      {status === "ERROR" && (
        <p className="text-xs text-destructive">{lastError || "The connection needs to be reconnected."}</p>
      )}
      {status === "RESTRICTED" && (
        <p className="text-xs text-destructive">Meta has restricted this WhatsApp Business Account. Check WhatsApp Manager for details.</p>
      )}
      {status === "PENDING_REVIEW" && (
        <p className={`text-xs ${TONE_TEXT.warning}`}>This WhatsApp Business Account is pending Meta&apos;s review.</p>
      )}

      {isConnectedish && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {qualityRating && (
            <>
              <dt>Quality rating</dt>
              <dd className={QUALITY_TONE[qualityRating] ? TONE_TEXT[QUALITY_TONE[qualityRating]] : undefined}>{qualityRating}</dd>
            </>
          )}
          {messagingLimitTier && (
            <>
              <dt>Messaging tier</dt>
              <dd>{messagingLimitTier}</dd>
            </>
          )}
          {fundingStatus && fundingStatus !== "UNKNOWN" && (
            <>
              <dt>Funding</dt>
              <dd className={fundingStatus === "UNFUNDED" ? "text-destructive" : TONE_TEXT.success}>
                {fundingStatus === "FUNDED" ? "Payment method on file" : "No payment method"}
              </dd>
            </>
          )}
          {tokenExpiresAt && (
            <>
              <dt>Token expires</dt>
              <dd>{new Date(tokenExpiresAt).toLocaleDateString()}</dd>
            </>
          )}
          <dt>Webhook received</dt>
          <dd>{webhookVerifiedAt ? new Date(webhookVerifiedAt).toLocaleString() : "Not yet — send a message to this number to confirm"}</dd>
          {onboardingStep && onboardingStep !== "COMPLETE" && (
            <>
              <dt>Setup progress</dt>
              <dd>{onboardingStep.replace(/_/g, " ").toLowerCase()}</dd>
            </>
          )}
        </dl>
      )}

      {(message ?? returnedMessage) && <p className="text-xs text-muted-foreground">{message ?? returnedMessage}</p>}

      {needsChoice && choices && choices.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-xs font-medium">Which WhatsApp number should this CRM use?</legend>
          {choices.flatMap((account) =>
            account.numbers.map((number) => (
              <label key={number.id} className="flex items-start gap-2 text-sm">
                <input
                  className="mt-1"
                  type="radio"
                  name="whatsapp-account"
                  checked={picked?.phoneNumberId === number.id}
                  onChange={() => setPicked({ wabaId: account.wabaId, phoneNumberId: number.id })}
                />
                <span>
                  {number.displayPhoneNumber}
                  <span className="block text-xs text-muted-foreground">
                    {[account.wabaName, number.verifiedName].filter(Boolean).join(" · ")}
                    {number.isMetaTestNumber && " · Meta test number, cannot receive real customer messages"}
                  </span>
                </span>
              </label>
            )),
          )}
          <div>
            <Button size="sm" disabled={busy || !picked} onClick={handleChoose}>
              Connect this number
            </Button>
          </div>
        </fieldset>
      )}
      {needsChoice && choices && choices.length === 0 && (
        <p className="text-xs text-muted-foreground">This choice has expired. Click Connect with Meta to start again.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {isConnectedish ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={handleTest}>
              Test Connection
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={handleDisconnect}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={handleConnect}>
            Connect with Meta
          </Button>
        )}
      </div>
    </div>
  );
}
