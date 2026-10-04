"use client";

import { useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { IdentityProposalView } from "@/lib/inbox/identity/graph";

import {
  confirmIdentityLinkAction,
  keepIdentitySeparateAction,
} from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

/**
 * "Possible existing lead found." This contact is not on any exact phone we know, but they look like a lead we already have.
 * Nothing has been linked and no new lead was created: a person chooses. Linking points THIS conversation at the lead (the
 * lead itself is not changed); "Create separate lead" keeps them apart and is never suggested again for this contact.
 */
export default function IdentityMatchCard({
  proposals,
  conversationId,
  canDecide,
  canCreateLead,
}: {
  proposals: IdentityProposalView[];
  conversationId: string;
  canDecide: boolean;
  canCreateLead: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();
  if (proposals.length === 0) return null;

  function linkTo(linkId: string) {
    startTransition(async () => {
      const result = await confirmIdentityLinkAction({
        conversationId,
        linkId,
      });
      if (result.ok) refreshInbox();
      toast.add({
        title: result.ok
          ? "Conversation linked"
          : "Could not link the conversation",
        description: result.ok
          ? "It now shows this lead's details. The lead itself was not changed."
          : result.error,
      });
    });
  }

  function keepSeparate() {
    startTransition(async () => {
      const result = await keepIdentitySeparateAction({ conversationId });
      if (result.ok) refreshInbox();
      toast.add({
        title: result.ok
          ? "Created a separate lead"
          : "Could not create the lead",
        description: result.ok
          ? "These will not be suggested as the same person again."
          : result.error,
      });
    });
  }

  return (
    <section aria-label="Possible existing lead found" className="space-y-2">
      <div>
        <p className="text-sm font-semibold">Possible existing lead found</p>
        <p className="text-xs text-muted-foreground">
          This may be someone you already know. Nothing has been linked yet.
        </p>
      </div>
      {proposals.map((proposal) => (
        <Card
          key={proposal.linkId}
          className="gap-2 bg-transparent! p-3 shadow-none!"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="wrap-break-word text-sm font-medium">
              {proposal.leadName}
            </p>
            <Badge variant={proposal.band === "HIGH" ? "default" : "secondary"}>
              {proposal.band === "HIGH" ? "Very likely" : "Possible"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {proposal.leadReference}
            {proposal.leadMobile ? ` · ${proposal.leadMobile}` : ""}
          </p>
          {proposal.reasons.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {proposal.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {canDecide && (
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => linkTo(proposal.linkId)}
            >
              Link conversation
            </Button>
          )}
        </Card>
      ))}
      {canDecide && canCreateLead && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={isPending}
          onClick={keepSeparate}
        >
          Create separate lead
        </Button>
      )}
    </section>
  );
}
