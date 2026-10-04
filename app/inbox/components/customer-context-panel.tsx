import { formatDistanceToNowStrict } from "date-fns";

import type { InboxCustomerContext, InboxIntelligenceData } from "../types";
import ConversationIntelligenceRail from "./conversation-intelligence-rail";
import CreateBookingButton from "./create-booking-button";
import IdentityMatchCard from "./identity-match-card";
import InboxCopilot from "./inbox-copilot";
import ConversationFollowUp from "./conversation-followup";
import CaptureConversationLeadButton from "./capture-conversation-lead-button";
import SelectDepartureGroupButton from "./select-departure-group-button";
import { ConversationConvertMenu } from "./conversation-convert-menu";
import { HandoffSummarySheet } from "./handoff-summary-sheet";
import { DepartureGroupStatusBlock } from "./departure-group-status-block";
import { LeadCompletenessBlock } from "./lead-completeness-block";
import { ConversationHistoryBlock } from "./conversation-history-block";
import { LinkedRecordLinksBlock } from "./linked-record-links-block";
import type { NextBestAction } from "@/lib/inbox/next-best-action";
import { RecommendedNextActionCard } from "./recommended-next-action-card";
import {
  CustomerContextAccordion,
  type CustomerContextSection,
} from "./customer-context-accordion";
import { CustomerIdentityHeader } from "./customer-identity-header";
import { buildIntelligenceRailView } from "@/lib/inbox/intelligence/rail-view";
import { leadCompletenessFor } from "@/lib/inbox/lead-completeness";

function CustomerContextDetail({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word text-sm">{value}</dd>
    </div>
  );
}

export default function CustomerContextPanel({
  context,
  conversationId,
  intelligence = null,
  intelligenceError = null,
  channelLabel = null,
  onRetryIntelligence,
  historyRef = null,
  nextAction = null,
}: {
  context: InboxCustomerContext;
  conversationId: string;
  /** Copilot's stored reading; `null` while it loads (the fourth, independent loader). */
  intelligence?: InboxIntelligenceData | null;
  intelligenceError?: string | null;
  channelLabel?: string | null;
  onRetryIntelligence?: () => void;
  /** When the chat started and its last update; the history block reads again when the update changes. */
  historyRef?: { startedAt: string; version: string } | null;
  /** The one deterministic action staff should consider next. */
  nextAction?: NextBestAction | null;
}) {
  const {
    lead,
    booking,
    handoff,
    canViewBalance,
    canCreateBooking,
    canUseCopilot,
    canScheduleFollowUp,
    canSelectDepartureGroup,
    canCreateLead,
    canConvertConversation,
  } = context;
  const matchedOffer = intelligence?.intelligence?.matchedOffer ?? null;
  const railProps = {
    data: intelligence,
    conversationId,
    canUseOffer: canUseCopilot,
    loadError: intelligenceError,
    onRetry: onRetryIntelligence,
    deterministic: {
      channelLabel,
      leadStage: lead?.stage ?? null,
      preferredLanguage: lead?.preferred_language ?? null,
    },
  };
  // Copilot's reading of the conversation, placed after who the customer is and what is still missing.
  const readingRail = (
    <div className="empty:hidden">
      <ConversationIntelligenceRail {...railProps} part="reading" />
    </div>
  );

  const copilotHasContent =
    canUseCopilot ||
    intelligence === null ||
    buildIntelligenceRailView(intelligence, railProps.deterministic) !== null;

  const sections: CustomerContextSection[] = [];
  if (lead) {
    const completeness = leadCompletenessFor({
      desiredPackageName: lead.desired_package_name,
      preferredPeriod: lead.preferred_period,
      mobile: lead.mobile,
      email: lead.email,
      adults: lead.adults,
      children: lead.children,
      roomPreference: lead.room_preference,
    });
    sections.push({
      id: "trip",
      title: "Trip",
      summary: `${completeness.collectedCount} of ${completeness.totalCount} details`,
      content: (
        <>
          <LeadCompletenessBlock
            conversationId={conversationId}
            lead={{
              desiredPackageName: lead.desired_package_name,
              preferredPeriod: lead.preferred_period,
              mobile: lead.mobile,
              email: lead.email,
              adults: lead.adults,
              children: lead.children,
              roomPreference: lead.room_preference,
            }}
          />
          <dl className="grid gap-3">
            <CustomerContextDetail
              label="Interested package"
              value={lead.desired_package_name}
            />
            <CustomerContextDetail
              label="Preferred period"
              value={lead.preferred_period}
            />
            <DepartureGroupStatusBlock
              selectedDepartureGroupId={lead.selected_departure_group_id}
              booking={booking}
              recommended={
                matchedOffer
                  ? {
                      departureGroupId: matchedOffer.departureGroupId,
                      title:
                        matchedOffer.groupName || "Best matching departure",
                    }
                  : null
              }
            />
          </dl>
        </>
      ),
    });
    sections.push({
      id: "booking",
      title: "Booking",
      summary: booking
        ? `${booking.booking_reference} · ${booking.booking_status.replaceAll("_", " ").toLowerCase()}`
        : "Not started",
      content: booking ? (
        <>
          <dl className="grid gap-3">
            <CustomerContextDetail
              label="Reference"
              value={booking.booking_reference}
            />
            <CustomerContextDetail
              label="Status"
              value={booking.booking_status.replaceAll("_", " ")}
            />
            <CustomerContextDetail
              label="Travellers"
              value={String(booking.traveller_count)}
            />
            {canViewBalance && booking.outstanding_balance != null && (
              <CustomerContextDetail
                label="Payment balance"
                value={`${booking.currency ?? "LKR"} ${booking.outstanding_balance.toLocaleString()}`}
              />
            )}
          </dl>
          {booking.booking_status === "CONFIRMED" && canUseCopilot && (
            <HandoffSummarySheet
              conversationId={conversationId}
              existingHandoff={handoff ?? null}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            No booking has been started.
          </p>
          {lead.selected_departure_group_id ? (
            canCreateBooking && (
              <CreateBookingButton conversationId={conversationId} />
            )
          ) : canSelectDepartureGroup ? (
            <SelectDepartureGroupButton
              conversationId={conversationId}
              lead={lead}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a departure group before creating the booking.
            </p>
          )}
        </>
      ),
    });
    sections.push({
      id: "follow-up",
      title: "Follow-up",
      summary: lead.next_follow_up_at
        ? formatDistanceToNowStrict(new Date(lead.next_follow_up_at), {
            addSuffix: true,
          })
        : "None scheduled",
      content: lead.next_follow_up_at ? (
        <dl className="grid gap-3">
          <CustomerContextDetail
            label="Next action"
            value={lead.follow_up_type?.replaceAll("_", " ").toLowerCase()}
          />
          <CustomerContextDetail
            label="Owner"
            value={lead.follow_up_owner_name}
          />
          <div>
            <dt className="sr-only">Due</dt>
            <dd className="text-xs text-muted-foreground">
              {formatDistanceToNowStrict(new Date(lead.next_follow_up_at), {
                addSuffix: true,
              })}
            </dd>
          </div>
        </dl>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            No follow-up is scheduled.
          </p>
          {canScheduleFollowUp && (
            <ConversationFollowUp conversationId={conversationId} />
          )}
        </>
      ),
    });
    if (copilotHasContent) {
      sections.push({
        id: "copilot",
        title: "Copilot",
        content: (
          <>
            {readingRail}
            {canUseCopilot && (
              <InboxCopilot
                leadId={lead.id}
                conversationId={conversationId}
                lead={{
                  desiredPackageName: lead.desired_package_name,
                  preferredPeriod: lead.preferred_period,
                  adults: lead.adults,
                  children: lead.children,
                  roomPreference: lead.room_preference,
                }}
                hasDepartureChoice={Boolean(
                  lead.selected_departure_group_id || booking,
                )}
              />
            )}
          </>
        ),
      });
    }
    if (canConvertConversation) {
      sections.push({
        id: "work",
        title: "Turn into work",
        content: (
          <>
            <p className="text-xs text-muted-foreground">
              Create a task or case for the team that points back at this
              conversation.
            </p>
            <ConversationConvertMenu conversationId={conversationId} />
          </>
        ),
      });
    }
    if (historyRef) {
      sections.push({
        id: "history",
        title: "Conversation history",
        content: (
          <ConversationHistoryBlock
            conversationId={conversationId}
            startedAt={historyRef.startedAt}
            version={historyRef.version}
          />
        ),
      });
    }
  }

  return (
    <aside
      className="h-full w-full min-w-0 overflow-y-auto custom-scroll bg-card"
      aria-label="Customer context"
    >
      {lead ? (
        <div className="pb-6">
          <CustomerIdentityHeader
            fullName={lead.full_name}
            reference={lead.reference}
            stage={lead.stage}
            preferredLanguage={lead.preferred_language}
          />
          <div className="space-y-4">
            <div className="space-y-3 px-4">
              <dl className="grid gap-2">
                <CustomerContextDetail
                  label="Phone"
                  value={lead.mobile || "No phone yet"}
                />
                <CustomerContextDetail label="Email" value={lead.email} />
              </dl>
              <LinkedRecordLinksBlock
                record={{
                  leadId: lead.id,
                  bookingId: booking?.id ?? null,
                  bookingDepartureGroupId: booking?.departure_group_id ?? null,
                  selectedDepartureGroupId: lead.selected_departure_group_id,
                  can: {
                    openLead: context.canOpenLead ?? false,
                    openBooking: context.canOpenBooking ?? false,
                    openDepartureGroup: context.canOpenDepartureGroup ?? false,
                  },
                }}
              />
            </div>
            {/* Human-review cards stay directly under who the customer is, above everything else, so an urgent flag is never pushed down. */}
            <div className="empty:hidden px-4">
              <ConversationIntelligenceRail {...railProps} part="risk" />
            </div>
            {nextAction && (
              <div className="px-4">
                <RecommendedNextActionCard
                  action={nextAction}
                  conversationId={conversationId}
                  canUseCopilot={canUseCopilot}
                  canConvertConversation={canConvertConversation ?? false}
                />
              </div>
            )}
            <CustomerContextAccordion sections={sections} />
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-4 py-5">
          <div className="empty:hidden">
            <ConversationIntelligenceRail {...railProps} part="risk" />
          </div>
          {nextAction && (
            <RecommendedNextActionCard
              action={nextAction}
              conversationId={conversationId}
              canUseCopilot={canUseCopilot}
              canConvertConversation={canConvertConversation ?? false}
            />
          )}
          <h2 className="text-sm font-medium">Customer details</h2>
          <IdentityMatchCard
            proposals={context.identityProposals ?? []}
            conversationId={conversationId}
            canDecide={context.canDecideIdentity ?? false}
            canCreateLead={canCreateLead}
          />
          <p className="text-xs text-muted-foreground">
            No lead is linked yet. Link the contact to an existing exact phone
            match or create a new lead before booking or scheduling follow-up.
          </p>
          {canCreateLead && (
            <CaptureConversationLeadButton conversationId={conversationId} />
          )}
          {readingRail}
          {historyRef && (
            <ConversationHistoryBlock
              conversationId={conversationId}
              startedAt={historyRef.startedAt}
              version={historyRef.version}
            />
          )}
        </div>
      )}
    </aside>
  );
}
