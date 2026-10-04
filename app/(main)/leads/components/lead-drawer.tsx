"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { TONE_BAR, TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  MapPin,
  MessageSquare,
  PackageCheck,
  Plus,
  PhoneCall,
  Search,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import React, { useState } from "react";

import type { AvailableGroupOption } from "../actions";
import { PendingActionButton } from "@/components/pending-action-button";
import { updateLeadConsentAction } from "../actions";
import { setLeadCampaignAction } from "@/app/(main)/campaigns/actions";
import ConsentCard from "@/components/consent-card";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "../leads-store";
import type { LeadListItem, LeadStage } from "../types";
import {
  CONTACT_CHANNEL_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  LOST_REASON_LABELS,
  ROOM_PREFERENCE_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  ACTIVE_STAGE_ORDER,
  STAGE_TONES,
  TEMPERATURE_LABELS,
  TEMPERATURE_TONES,
  followUpLabel,
  formatDateTime,
  formatExactLKR,
  partySizeLabel,
  pastLabel,
  whatsappLink,
} from "../utils";
import ConvertToBookingDialog from "./convert-to-booking-dialog";
import ManasikDecision from "./copilot/manasik-decision";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE } from "./copilot/offer-parts";
import FindAvailableGroupsSheet from "./find-available-groups-sheet";
import SendQuoteSheet from "./send-quote-sheet";
import SetFollowUpDialog from "./set-follow-up-dialog";
import { JourneyBadge } from "../leads-table/leads-columns";

import { ActorChip } from "@/components/ui/copilot-mark";
import SectionHeading from "@/components/section-heading";
interface LeadDrawerProps {
  /** `null` closes the drawer; the sheet is mounted once by the list page. */
  lead: LeadListItem | null;
  onClose: () => void;
  onChangeStage: (lead: LeadListItem, stage: LeadStage) => void;
  onAssign: (lead: LeadListItem, staffId: string) => void;
  onLogContact: (lead: LeadListItem) => void;
  onMarkLost: (lead: LeadListItem) => void;
}

/** Copy button that confirms in place rather than through a toast storm. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.add({
        title: "Could not copy",
        description: "Your browser blocked clipboard access.",
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      {copied ? (
        <Check className={cn("size-3.5", TONE_TEXT.success)} />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </Button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right min-w-0">{children}</span>
    </div>
  );
}

const LeadDrawer = ({
  lead,
  onClose,
  onChangeStage,
  onAssign,
  onLogContact,
  onMarkLost,
}: LeadDrawerProps) => {
  const {
    can,
    addNote,
    setFollowUp,
    completeFollowUp,
    selectDepartureGroup,
    staffOptions,
    campaignOptions,
  } = useLeads();
  const router = useRouter();

  const [noteDraft, setNoteDraft] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<LeadListItem | null>(
    null,
  );
  const [groupSheetTarget, setGroupSheetTarget] = useState<LeadListItem | null>(
    null,
  );
  const [quoteTarget, setQuoteTarget] = useState<LeadListItem | null>(null);
  const [convertTarget, setConvertTarget] = useState<LeadListItem | null>(null);

  const submitNote = async (leadId: string) => {
    if (!noteDraft.trim()) return;
    setAddingNote(true);
    const result = await addNote(leadId, noteDraft.trim());
    setAddingNote(false);
    if (!result.ok) {
      toast.add({ title: "Could not add note", description: result.error });
      return;
    }
    setNoteDraft("");
  };

  const handleSelectGroup = async (
    lead: LeadListItem,
    group: AvailableGroupOption,
  ) => {
    const result = await selectDepartureGroup({
      leadId: lead.id,
      departureGroupId: group.id,
      groupLabel: `${group.groupName} (${group.groupCode})`,
    });
    setGroupSheetTarget(null);
    if (!result.ok) {
      toast.add({ title: "Could not select group", description: result.error });
      return;
    }
    toast.add({
      title: "Departure group selected",
      description: group.groupName,
    });
  };

  const canConvert =
    can.convertToBooking &&
    lead !== null &&
    !lead.bookingId &&
    lead.selectedDepartureGroupId !== null &&
    (lead.stage === "DEPOSIT_PENDING" ||
      lead.stage === "NEGOTIATION" ||
      lead.stage === "PROPOSAL_SENT");

  return (
    <>
      <SetFollowUpDialog
        lead={followUpTarget}
        onClose={() => setFollowUpTarget(null)}
        onSubmit={async (input) => {
          if (!followUpTarget) return;
          const result = await setFollowUp({
            leadId: followUpTarget.id,
            ...input,
          });
          setFollowUpTarget(null);
          if (!result.ok) {
            toast.add({
              title: "Could not schedule follow-up",
              description: result.error,
            });
            return;
          }
          toast.add({ title: "Follow-up scheduled" });
        }}
      />

      <FindAvailableGroupsSheet
        lead={groupSheetTarget}
        onClose={() => setGroupSheetTarget(null)}
        onSelect={(group) =>
          groupSheetTarget && handleSelectGroup(groupSheetTarget, group)
        }
      />

      <SendQuoteSheet
        lead={quoteTarget}
        onClose={() => setQuoteTarget(null)}
        onSent={() => setQuoteTarget(null)}
      />

      <ConvertToBookingDialog
        lead={convertTarget}
        onClose={() => setConvertTarget(null)}
        onConverted={() => setConvertTarget(null)}
      />

      <Sheet open={lead !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="data-[side=right]:sm:max-w-xl w-full p-0 gap-0 flex flex-col">
          {lead && (
            <>
              <SheetHeader className="gap-2">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "size-11 rounded-full flex items-center justify-center font-bold text-sm shrink-0",
                      lead.avatarTone,
                    )}
                    aria-hidden
                  >
                    {lead.initials}
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="text-2xl font-semibold tracking-tight">
                      {lead.name}
                    </SheetTitle>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground font-number">
                      {lead.reference}
                      <CopyButton value={lead.reference} label="lead ID" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <ToneBadge
                    tone={STAGE_TONES[lead.stage]}
                    icon={
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          TONE_BAR[STAGE_TONES[lead.stage]],
                        )}
                        aria-hidden
                      />
                    }
                    label={STAGE_LABELS[lead.stage]}
                  />
                  <ToneBadge
                    tone={TEMPERATURE_TONES[lead.temperature]}
                    label={TEMPERATURE_LABELS[lead.temperature]}
                  />
                  <JourneyBadge lead={lead} />
                  {lead.quotaWaitlistInterest && (
                    <ToneBadge tone="warning" label="Quota waitlist" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Owner: {lead.assignedToName} · Source:{" "}
                  {SOURCE_LABELS[lead.source]}
                </p>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto custom-scroll flex flex-col gap-4 px-4 pb-6">
                {/* Quick actions — WhatsApp leads since it is the agency's primary channel. */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* A lead from Messenger/Instagram has no number until the customer gives one. */}
                  {lead.mobileRaw && (
                    <>
                      <Button
                        render={
                          <a
                            href={whatsappLink(lead.mobileRaw)}
                            target="_blank"
                            rel="noreferrer noopener"
                          />
                        }
                      >
                        <MessageSquare /> WhatsApp
                      </Button>
                      <Button
                        variant="outline_without_border"
                        render={<a href={`tel:+94${lead.mobileRaw}`} />}
                      >
                        <PhoneCall /> Call
                      </Button>
                    </>
                  )}
                  {can.logContact && (
                    <Button
                      variant="outline_without_border"
                      onClick={() => onLogContact(lead)}
                      disabled={lead.isClosed}
                    >
                      <MessageSquare /> Add Note / Log Contact
                    </Button>
                  )}
                  {can.sendQuote && (
                    <Button
                      variant="outline_without_border"
                      onClick={() => setQuoteTarget(lead)}
                      disabled={lead.isClosed}
                    >
                      <FileText /> Send Quote
                    </Button>
                  )}
                  {can.logContact && (
                    <Button
                      variant="outline_without_border"
                      onClick={() => setFollowUpTarget(lead)}
                      disabled={lead.isClosed}
                    >
                      <Calendar /> Set Follow-up
                    </Button>
                  )}
                </div>

                {/* Follow-up state — the single most important thing on this panel. */}
                {!lead.isClosed && (
                  <Card
                    className={cn(
                      "p-3 gap-1",
                      lead.followUpStatus === "OVERDUE" &&
                        TONE_STAT_CARD.danger,
                      lead.followUpStatus === "TODAY" && TONE_STAT_CARD.warning,
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {lead.followUpStatus === "OVERDUE" && (
                        <AlertCircle className="size-3.5 text-destructive" />
                      )}
                      Next follow-up
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {followUpLabel(
                        lead.nextFollowUpAt,
                        lead.daysUntilFollowUp,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lead.followUpType
                        ? FOLLOW_UP_TYPE_LABELS[lead.followUpType]
                        : "Nothing scheduled"}
                      {lead.followUpOwnerName
                        ? ` · ${lead.followUpOwnerName}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last contact:{" "}
                      {pastLabel(
                        lead.lastContactedAt,
                        lead.daysSinceLastContact,
                      )}
                    </p>

                    {lead.followUpStatus === "OVERDUE" && (
                      <div className="flex items-center gap-2 mt-2">
                        <PendingActionButton
                          size="sm"
                          variant="secondary"
                          pendingLabel="Completing…"
                          onAction={async () => {
                            const result = await completeFollowUp(lead.id);
                            if (!result.ok) {
                              toast.add({
                                title: "Could not complete follow-up",
                                description: result.error,
                              });
                              return;
                            }
                            toast.add({ title: "Follow-up marked complete" });
                          }}
                        >
                          <CheckCircle2 /> Complete
                        </PendingActionButton>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setFollowUpTarget(lead)}
                        >
                          <Calendar /> Reschedule
                        </Button>
                      </div>
                    )}
                  </Card>
                )}

                {lead.stage === "LOST" && (
                  <Card className={cn("p-3 gap-1", TONE_STAT_CARD.danger)}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Marked lost
                    </div>
                    <p className="text-sm text-foreground">
                      {lead.lostReason
                        ? LOST_REASON_LABELS[lead.lostReason]
                        : "No reason recorded"}
                    </p>
                    {lead.lostNote && (
                      <p className="text-xs text-muted-foreground">
                        {lead.lostNote}
                      </p>
                    )}
                  </Card>
                )}

                {/* Contact */}
                <Card className="gap-2 p-4 pt-2">
                  <SectionHeading title="Contact" />
                  <div className="flex flex-col gap-1">
                    <DetailRow label="Mobile / WhatsApp">
                      <span className="inline-flex items-center gap-1 font-number">
                        {lead.mobile || (
                          <span className="font-sans text-muted-foreground">
                            No phone yet
                          </span>
                        )}
                        {lead.mobileRaw && (
                          <CopyButton
                            value={`+94${lead.mobileRaw}`}
                            label="mobile number"
                          />
                        )}
                      </span>
                    </DetailRow>
                    <DetailRow label="Email">
                      {lead.email ? (
                        <span className="inline-flex items-center gap-1 break-all">
                          {lead.email}
                          <CopyButton
                            value={lead.email}
                            label="email address"
                          />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Not provided
                        </span>
                      )}
                    </DetailRow>
                    <DetailRow label="City">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        {lead.city}
                      </span>
                    </DetailRow>
                    <DetailRow label="Preferred language">
                      {lead.preferredLanguage}
                    </DetailRow>
                    <DetailRow label="Preferred channel">
                      {CONTACT_CHANNEL_LABELS[lead.preferredChannel]}
                    </DetailRow>
                  </div>
                </Card>

                <ConsentCard
                  consentStatus={lead.consentStatus}
                  consentSource={lead.consentSource}
                  consentAt={lead.consentAt}
                  doNotContact={lead.doNotContact}
                  contactableChannels={lead.contactableChannels}
                  canManage
                  onSave={(input) => updateLeadConsentAction({ leadId: lead.id, ...input })}
                />

                {/* Campaign attribution */}
                <Card className="gap-2 p-4 pt-2">
                  <SectionHeading title="Campaign Attribution" />
                  <div className="flex flex-col gap-2">
                    <Select
                      value={lead.campaignId ?? "NONE"}
                      onValueChange={(value) =>
                        setLeadCampaignAction({
                          leadId: lead.id,
                          campaignId: value === "NONE" ? null : value,
                          attributionType: lead.attributionType,
                        }).then((result) => {
                          if (!result.ok) {
                            toast.add({ title: "Could not attribute lead", description: result.error });
                            return;
                          }
                          router.refresh();
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="No campaign" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">No campaign</SelectItem>
                        {campaignOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lead.campaignId && (
                      <Select
                        value={lead.attributionType}
                        onValueChange={(value) =>
                          setLeadCampaignAction({
                            leadId: lead.id,
                            campaignId: lead.campaignId,
                            attributionType: value as "DIRECT" | "ASSISTED" | "UNKNOWN",
                          }).then((result) => {
                            if (!result.ok) {
                              toast.add({ title: "Could not update attribution", description: result.error });
                              return;
                            }
                            router.refresh();
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNKNOWN">Unknown certainty</SelectItem>
                          <SelectItem value="DIRECT">Direct</SelectItem>
                          <SelectItem value="ASSISTED">Assisted</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </Card>

                {/* Journey interest / opportunity */}
                <Card className="p-3 gap-2">
                  <SectionHeading title="Journey interest" />
                  <DetailRow label="Interested in">
                    {lead.interestedIn}
                  </DetailRow>
                  <DetailRow label="Desired package">
                    {lead.packageName}
                  </DetailRow>
                  <DetailRow label="Preferred period">
                    {lead.preferredPeriod}
                  </DetailRow>
                  <DetailRow label="Traveller count">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5 text-muted-foreground" />
                      {partySizeLabel(lead.adults, lead.children)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Room preference">
                    {ROOM_PREFERENCE_LABELS[lead.roomPreference]}
                  </DetailRow>
                  <DetailRow label="Budget range">{lead.budgetRange}</DetailRow>
                  <DetailRow label="Estimated value">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-semibold font-number",
                        TONE_TEXT.success,
                      )}
                    >
                      <TrendingUp className="size-3.5" />
                      {formatExactLKR(lead.estimatedValueLkr)}
                    </span>
                  </DetailRow>

                  {can.findGroups && !lead.isClosed && (
                    <div className="flex items-center gap-2 pt-2 mt-1 border-t border-border/40">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setGroupSheetTarget(lead)}
                      >
                        <Search /> Find Available Groups
                      </Button>
                      {lead.selectedDepartureGroupId && (
                        <span className="text-xs text-muted-foreground">
                          Group selected
                        </span>
                      )}
                    </div>
                  )}
                </Card>

                {/* Manasik Decision — the Sales Intelligence Engine, on request only. */}
                {can.useCopilot && !lead.isClosed && (
                  <ManasikDecision
                    key={lead.id}
                    lead={lead}
                    onViewAllGroups={setGroupSheetTarget}
                  />
                )}

                {can.viewQuotes && lead.quotes.length > 0 && (
                  <Card className="p-3 gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Quotes
                    </h3>
                    <ol className="flex flex-col gap-1.5">
                      {lead.quotes.map((quote) => (
                        <li
                          key={quote.id}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="font-number text-foreground">
                              {quote.reference}
                            </span>
                            <ToneBadge
                              tone={QUOTE_STATUS_TONE[quote.status]}
                              label={QUOTE_STATUS_LABEL[quote.status]}
                            />
                          </span>
                          <span className="text-right">
                            <span className="block font-number text-foreground">
                              {formatExactLKR(quote.totalLkr)}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              Valid until {formatDateTime(quote.validUntil)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </Card>
                )}

                {canConvert && (
                  <Card className={cn("p-3 gap-2", TONE_STAT_CARD.success)}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Ready to convert
                    </h3>
                    <p className="text-sm text-foreground">
                      A departure group is selected. Create the booking to hold{" "}
                      {lead.partySize} seat{lead.partySize === 1 ? "" : "s"}.
                    </p>
                    <Button
                      size="sm"
                      className="self-start"
                      onClick={() => setConvertTarget(lead)}
                    >
                      <PackageCheck /> Create Booking &amp; Hold Seats
                    </Button>
                  </Card>
                )}

                {lead.bookingId && (
                  <Card className={cn("p-3 gap-1", TONE_STAT_CARD.success)}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Booked
                    </div>
                    <p className="text-sm text-foreground">
                      This lead converted to a booking. See Departure Groups for
                      the pilgrim and payment record.
                    </p>
                  </Card>
                )}

                {/* Ownership */}
                <Card className="p-3 gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ownership & source
                  </h3>
                  <DetailRow label="Assigned owner">
                    {can.assignLeads ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="sm" className="gap-1">
                              <UserCheck className="size-3.5" />
                              {lead.assignedToName}
                              <ChevronDown className="size-3.5" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Reassign to</DropdownMenuLabel>
                          {staffOptions.map((staff) => (
                            <DropdownMenuItem
                              key={staff.id}
                              disabled={staff.id === lead.assignedToId}
                              onClick={() => onAssign(lead, staff.id)}
                            >
                              {staff.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      lead.assignedToName
                    )}
                  </DetailRow>
                  <DetailRow label="Source">
                    {SOURCE_LABELS[lead.source]}
                  </DetailRow>
                  {lead.campaignReference && (
                    <DetailRow label="Campaign">
                      {lead.campaignReference}
                    </DetailRow>
                  )}
                  {lead.referralName && (
                    <DetailRow label="Referred by">
                      {lead.referralName}
                    </DetailRow>
                  )}
                  <DetailRow label="Created">
                    {formatDateTime(lead.createdAt)} · {lead.ageInDays} day
                    {lead.ageInDays === 1 ? "" : "s"} old
                  </DetailRow>
                </Card>

                {/* Internal notes */}
                <Card className="p-3 gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Internal notes{" "}
                    <span className="normal-case font-normal">
                      (internal only — never shown to the customer)
                    </span>
                  </h3>
                  {lead.notes.length === 0 ? (
                    <EmptyState title="No notes yet" />
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {lead.notes.map((note) => (
                        <li key={note.id} className="text-sm">
                          <p className="text-foreground whitespace-pre-wrap">
                            {note.body}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {note.authorName} · {formatDateTime(note.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                  {can.addNote && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <InputGroup className="h-16">
                        <InputGroupTextarea
                          rows={2}
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder="Add an internal note…"
                          className="text-xs p-2"
                        />
                      </InputGroup>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="self-start"
                        disabled={!noteDraft.trim() || addingNote}
                        onClick={() => submitNote(lead.id)}
                      >
                        <Plus /> Add Note
                      </Button>
                    </div>
                  )}
                </Card>

                {/* Stage control */}
                {can.changeStage && (
                  <Card className="p-3 gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Pipeline
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ACTIVE_STAGE_ORDER.map((stage) => {
                        const isCurrent = stage === lead.stage;
                        return (
                          <Button
                            key={stage}
                            variant={isCurrent ? "secondary" : "ghost"}
                            size="sm"
                            aria-pressed={isCurrent}
                            onClick={() =>
                              !isCurrent && onChangeStage(lead, stage)
                            }
                            className={cn(
                              "gap-1.5",
                              !isCurrent && "text-muted-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                TONE_BAR[STAGE_TONES[stage]],
                              )}
                              aria-hidden
                            />
                            {STAGE_LABELS[stage]}
                          </Button>
                        );
                      })}
                    </div>
                    {!lead.isClosed && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="self-start mt-1"
                        onClick={() => onMarkLost(lead)}
                      >
                        <Ban /> Mark as Lost…
                      </Button>
                    )}
                  </Card>
                )}

                {/* Activity trail */}
                <Card className="p-3 gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Activity
                  </h3>
                  {lead.activity.length === 0 ? (
                    <EmptyState title="Nothing recorded yet" />
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {lead.activity.map((entry) => (
                        <li key={entry.id} className="flex gap-2.5">
                          <span
                            className="mt-1.5 size-1.5 rounded-full bg-primary/60 shrink-0"
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">
                              {entry.message}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              <ActorChip name={entry.actorName} inline /> ·{" "}
                              {formatDateTime(entry.createdAt)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};

export default LeadDrawer;
