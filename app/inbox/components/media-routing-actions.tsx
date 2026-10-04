"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  mediaRoutingOptions,
  type MediaRoutingDestination,
  type MediaRoutingKind,
} from "@/lib/inbox/media/routing";

import { saveInboxMediaToVaultAction } from "../vault-actions";
import { useInboxRefresh } from "./inbox-refresh-context";

type VaultDestination = Extract<
  MediaRoutingDestination,
  "PROPOSAL_COLLATERAL" | "DOCUMENTS"
>;

/**
 * Explicit, safe next steps for a customer's brochure or other file. Every destination is a staff click: nothing here
 * sends the file to a customer or publishes it. A file that cannot be read automatically keeps its manual download.
 */
export function MediaRoutingActions({
  attachmentId,
  kind,
  mimeType,
  originalHref,
  savedDocumentId,
  canSaveToVault,
}: {
  attachmentId: string;
  kind: MediaRoutingKind;
  mimeType: string;
  originalHref: string | null;
  savedDocumentId: string | null;
  canSaveToVault: boolean;
}) {
  const refreshInbox = useInboxRefresh();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const decision = mediaRoutingOptions({
    kind,
    mimeType,
    byteSize: null,
    hasOriginal: originalHref !== null,
    savedDocumentId,
    can: {
      saveToVault: canSaveToVault,
      openFinanceReview: false,
      saveToTravellerDocuments: false,
    },
  });

  const saveTo = (destination: VaultDestination) =>
    startTransition(async () => {
      const result = await saveInboxMediaToVaultAction({
        attachmentId,
        destination,
      });
      setStatus(result.ok ? result.message : result.error);
      if (result.ok) refreshInbox();
    });

  return (
    <Card
      className="gap-3 p-4 shadow-sm"
      aria-label="What to do with this file"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {kind === "BROCHURE"
            ? "Brochure from the customer"
            : "File from the customer"}
        </p>
        <p className="text-xs text-muted-foreground">
          Choose where to keep this file. Nothing is sent to the customer.
        </p>
      </div>

      {decision.limitation && (
        <p className="text-xs text-muted-foreground" role="note">
          {decision.limitation}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {decision.options.map((option) => (
          <li
            key={option.destination}
            className="flex flex-wrap items-center gap-2"
          >
            {option.destination === "DOWNLOAD" ? (
              option.availability === "AVAILABLE" && originalHref ? (
                <Button
                  size="sm"
                  variant="outline_without_border"
                  nativeButton={false}
                  render={
                    <a
                      href={originalHref}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  {option.label}
                </Button>
              ) : null
            ) : option.availability === "DONE" ? (
              <Badge variant="secondary">Saved to Documents</Badge>
            ) : option.availability === "AVAILABLE" ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => saveTo(option.destination as VaultDestination)}
              >
                {pending ? "Saving…" : option.label}
              </Button>
            ) : null}
            {option.availability !== "AVAILABLE" &&
              option.availability !== "DONE" &&
              option.reason && (
                <span className="text-xs text-muted-foreground">
                  {option.reason}
                </span>
              )}
          </li>
        ))}
      </ul>

      {status && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
    </Card>
  );
}
