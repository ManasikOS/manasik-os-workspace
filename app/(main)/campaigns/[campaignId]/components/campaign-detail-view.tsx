"use client";

import { useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroupField } from "@/components/ui/input-group";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { Plus, Sparkles } from "lucide-react";

import {
  formatDate,
  formatExactCurrency,
} from "@/app/(main)/departure-groups/utils";
import { colomboDayKey } from "@/lib/date";
import type {
  CampaignBookingRow,
  CampaignLeadRow,
  CampaignQuoteRow,
  WhatsAppTemplateOption,
  WeightedAttributionRow,
} from "@/lib/data/campaigns-repository";
import type {
  CampaignAssetRow,
  CampaignAssetType,
  CampaignAudienceEligibility,
  CampaignChannel,
  CampaignChannelStatus,
  CampaignChannelWithMetrics,
  CampaignExperimentStatus,
  CampaignExperimentWithVariants,
  CampaignSpendEntryRow,
  CampaignStatus,
  CampaignTouchpointRow,
  CampaignWithMetrics,
} from "@/lib/types/campaigns";
import type { AudienceProposalFilters } from "@/lib/copilot/marketing/types";
import type {
  InsightOutcomeType,
  InsightSeverity,
  InsightWithEvidence,
} from "@/lib/types/insights";
import type { Tone } from "@/lib/ui/tone";

import {
  addCampaignAssetAction,
  addCampaignChannelAction,
  addCampaignSpendAction,
  createAudienceFromCampaignProposalAction,
  createCampaignExperimentAction,
  draftCampaignContentAction,
  linkCampaignChannelExternalCampaignAction,
  listAdPlatformCampaignsAction,
  recordCampaignInsightOutcomeAction,
  suggestCampaignAudienceAction,
  syncCampaignChannelSpendAction,
  updateCampaignChannelStatusAction,
  updateCampaignExperimentAction,
  updateCampaignStatusAction,
} from "../../actions";
import {
  CAMPAIGN_OBJECTIVE_LABELS,
  CAMPAIGN_TYPE_LABELS,
  CHANNEL_LABELS,
} from "../../components/campaigns-list-view";

const ASSET_TYPE_LABELS: Record<CampaignAssetType, string> = {
  MESSAGE_TEMPLATE: "WhatsApp template",
  LANDING_PAGE: "Landing page",
  BROCHURE: "Brochure",
  QR_CODE: "QR code",
  TRACKING_LINK: "Tracking link",
  CREATIVE: "Creative",
  OTHER: "Other",
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "neutral",
  ARCHIVED: "neutral",
};

const SEVERITY_TONE: Record<InsightSeverity, Tone> = {
  INFO: "neutral",
  WARNING: "warning",
  CRITICAL: "danger",
};

type TabId =
  | "overview"
  | "leads"
  | "quotes"
  | "bookings"
  | "revenue"
  | "audience"
  | "channels"
  | "content"
  | "experiments"
  | "attribution"
  | "ai";

interface CampaignDetailViewProps {
  campaign: CampaignWithMetrics;
  leads: CampaignLeadRow[];
  quotes: CampaignQuoteRow[];
  bookings: CampaignBookingRow[];
  spend: CampaignSpendEntryRow[];
  assets: CampaignAssetRow[];
  insights: InsightWithEvidence[];
  channels: CampaignChannelWithMetrics[];
  experiments: CampaignExperimentWithVariants[];
  audienceEligibility: CampaignAudienceEligibility | null;
  whatsappTemplateOptions: WhatsAppTemplateOption[];
  firstTouches: CampaignTouchpointRow[];
  lastTouches: CampaignTouchpointRow[];
  assistedTouches: CampaignTouchpointRow[];
  weightedAttribution: WeightedAttributionRow[];
  metaAdsConnected: boolean;
  googleAdsConnected: boolean;
  canManage: boolean;
  canManageStatus: boolean;
  canEditSpend: boolean;
  canManageContent: boolean;
  canActOnDiagnosis: boolean;
}

export default function CampaignDetailView({
  campaign,
  leads,
  quotes,
  bookings,
  spend,
  assets,
  insights,
  channels,
  experiments,
  audienceEligibility,
  whatsappTemplateOptions,
  firstTouches,
  lastTouches,
  assistedTouches,
  weightedAttribution,
  metaAdsConnected,
  googleAdsConnected,
  canManage,
  canManageStatus,
  canEditSpend,
  canManageContent,
  canActOnDiagnosis,
}: CampaignDetailViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [spendOpen, setSpendOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [audienceSuggestOpen, setAudienceSuggestOpen] = useState(false);
  const [contentDraftOpen, setContentDraftOpen] = useState(false);
  const [trackingAssetOpen, setTrackingAssetOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const [attributionTouchType, setAttributionTouchType] = useState<
    "FIRST" | "LAST" | "ASSISTED"
  >("FIRST");

  const changeStatus = async (status: CampaignStatus) => {
    const result = await updateCampaignStatusAction(campaign.id, status);
    if (!result.ok) {
      toast.add({
        title: "Could not update status",
        description: result.error,
      });
      return;
    }
    if (result.warning) {
      toast.add({
        title: `Marked ${STATUS_LABELS[status]} — capacity warning`,
        description: result.warning,
      });
    } else {
      toast.add({ title: `Marked ${STATUS_LABELS[status]}` });
    }
  };

  const openInsights = insights.filter(
    (i) => i.status === "OPEN" || i.status === "ACKNOWLEDGED",
  );
  const topInsight = openInsights[0] ?? null;

  const daysToCutoff = campaign.booking_cutoff_at
    ? Math.ceil(
        (new Date(campaign.booking_cutoff_at).getTime() - now) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={campaign.name}
        breadcrumb={[
          { title: "Grow", link: "#" },
          { title: "Campaigns", link: "/campaigns" },
          { title: campaign.name, link: "#" },
        ]}
        subTitle={
          <span className="flex items-center gap-2">
            <ToneBadge
              tone={STATUS_TONE[campaign.status]}
              label={STATUS_LABELS[campaign.status]}
            />
            <span>{CAMPAIGN_TYPE_LABELS[campaign.campaign_type]}</span>
            <span>· {CAMPAIGN_OBJECTIVE_LABELS[campaign.objective]}</span>
          </span>
        }
        action={
          canManageStatus && (
            <div className="flex items-center gap-2">
              {campaign.status === "DRAFT" && (
                <Button onClick={() => changeStatus("ACTIVE")}>Activate</Button>
              )}
              {campaign.status === "ACTIVE" && (
                <Button variant="ghost" onClick={() => changeStatus("PAUSED")}>
                  Pause
                </Button>
              )}
              {campaign.status === "PAUSED" && (
                <Button onClick={() => changeStatus("ACTIVE")}>Resume</Button>
              )}
              {(campaign.status === "ACTIVE" ||
                campaign.status === "PAUSED") && (
                <Button
                  variant="ghost"
                  onClick={() => changeStatus("COMPLETED")}
                >
                  Mark Completed
                </Button>
              )}
            </div>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="revenue">Revenue &amp; Margin</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
          <TabsTrigger value="ai">AI Analysis</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              title="Bookings"
              value={`${campaign.metrics.bookingCount}${campaign.target_bookings ? ` / ${campaign.target_bookings}` : ""}`}
            />
            <KpiCard
              title="Seats available"
              value={
                campaign.capacity
                  ? String(campaign.capacity.availableSeats)
                  : "—"
              }
            />
            <KpiCard
              title="Spend"
              value={`${formatExactCurrency(campaign.metrics.totalSpend)}${campaign.budget ? ` / ${formatExactCurrency(campaign.budget)}` : ""}`}
            />
            <KpiCard
              title="Days to booking cutoff"
              value={daysToCutoff != null ? String(daysToCutoff) : "—"}
            />
            <KpiCard
              title="Qualified leads"
              value={String(campaign.metrics.qualifiedLeadCount)}
            />
            <KpiCard
              title="Quotes sent"
              value={String(campaign.metrics.quoteCount)}
            />
            <KpiCard
              title="Collected"
              value={formatExactCurrency(campaign.metrics.collected)}
            />
            <KpiCard
              title="Est. gross margin"
              value={
                campaign.metrics.estimatedGrossMargin != null
                  ? formatExactCurrency(campaign.metrics.estimatedGrossMargin)
                  : "—"
              }
            />
          </div>

          {campaign.capacity && (
            <Card className="p-4 flex flex-col gap-1">
              <h3 className="text-sm font-medium text-foreground">
                Linked departure
              </h3>
              <p className="text-sm text-foreground">
                {campaign.capacity.groupName} ({campaign.capacity.groupCode}) —
                departs {formatDate(campaign.capacity.departureDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                {campaign.capacity.bookedSeats} booked ·{" "}
                {campaign.capacity.heldSeats} held ·{" "}
                {campaign.capacity.availableSeats} of{" "}
                {campaign.capacity.capacity} seats available · sales status{" "}
                {campaign.capacity.salesStatus}
              </p>
            </Card>
          )}

          {topInsight && (
            <Card className="p-4 flex flex-col gap-2 border-l-4 border-l-primary">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">
                  Campaign Diagnosis
                </h3>
                <ToneBadge
                  tone={SEVERITY_TONE[topInsight.severity]}
                  label={topInsight.severity}
                />
              </div>
              <p className="text-sm text-foreground">{topInsight.title}</p>
              <p className="text-xs text-muted-foreground">
                {topInsight.description}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="w-fit"
                onClick={() => setTab("ai")}
              >
                Open AI Analysis
              </Button>
            </Card>
          )}

          {campaign.notes && (
            <Card className="p-4">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {campaign.notes}
              </p>
            </Card>
          )}

          <TrackingAssetsCard
            assets={assets.filter(
              (a) =>
                a.asset_type === "QR_CODE" || a.asset_type === "TRACKING_LINK",
            )}
            canManageContent={canManageContent}
            onAdd={() => setTrackingAssetOpen(true)}
          />
        </div>
      )}

      {tab === "leads" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {leads.length === 0 ? (
            <EmptyState
              title="No leads attributed yet"
              description="Attribute a lead to this campaign from its own drawer."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Lead", "Stage", "Attribution", "Created"].map((label) => (
                    <TableHead
                      key={label}
                      className="h-9 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {leads.map((l) => (
                  <TableRow
                    key={l.id}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() => router.push(`/leads?open=${l.id}`)}
                  >
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {l.fullName}{" "}
                      <span className="text-muted-foreground">
                        · {l.reference}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {l.stage}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {l.attributionType}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {formatDate(l.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "quotes" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              title="Quotes sent"
              value={String(campaign.metrics.quoteCount)}
            />
            <KpiCard
              title="Accepted"
              value={String(campaign.metrics.acceptedQuoteCount)}
            />
            <KpiCard
              title="Quote value"
              value={formatExactCurrency(campaign.metrics.quoteValue)}
            />
            <KpiCard
              title="Quote → booking"
              value={`${Math.round(campaign.metrics.quoteToBookingRate * 100)}%`}
            />
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {quotes.length === 0 ? (
              <EmptyState
                title="No quotes yet"
                description="Quotes appear here once sent to a lead attributed to this campaign."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Quote",
                      "Lead",
                      "Status",
                      "Total",
                      "Deposit",
                      "Room",
                      "Valid until",
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-9 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {quotes.map((q) => (
                    <TableRow
                      key={q.id}
                      className="hover:bg-muted/40 cursor-pointer"
                      onClick={() => router.push(`/leads?open=${q.leadId}`)}
                    >
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {q.reference}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {q.leadFullName}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {q.status}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(q.totalLkr)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(q.depositLkr)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {q.roomPreference}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {formatDate(q.validUntil)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === "bookings" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {bookings.length === 0 ? (
            <EmptyState
              title="No bookings attributed yet"
              description="A booking is attributed once its lead's campaign carries through."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Booking",
                    "Contact",
                    "Status",
                    "Total",
                    "Paid",
                    "Attribution",
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className="h-9 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {bookings.map((b) => (
                  <TableRow
                    key={b.id}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() =>
                      router.push(
                        `/departure-groups/${b.departureGroupId}/bookings/${b.id}`,
                      )
                    }
                  >
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {b.bookingReference}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {b.primaryContactName}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {b.bookingStatus}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {formatExactCurrency(b.totalBookingValue)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {formatExactCurrency(b.amountPaid)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {b.attributionType}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "revenue" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <KpiCard
              title="Booked revenue"
              value={formatExactCurrency(campaign.metrics.revenue)}
            />
            <KpiCard
              title="Collected revenue"
              value={formatExactCurrency(campaign.metrics.collected)}
            />
            <KpiCard
              title="Outstanding receivables"
              value={formatExactCurrency(campaign.metrics.outstanding)}
            />
            <KpiCard
              title="Marketing spend"
              value={formatExactCurrency(campaign.metrics.totalSpend)}
            />
            <KpiCard
              title="Estimated gross margin"
              value={
                campaign.metrics.estimatedGrossMargin != null
                  ? formatExactCurrency(campaign.metrics.estimatedGrossMargin)
                  : "Not available"
              }
            />
            <KpiCard
              title="Cost per qualified lead"
              value={
                campaign.metrics.costPerQualifiedLead != null
                  ? formatExactCurrency(campaign.metrics.costPerQualifiedLead)
                  : "—"
              }
            />
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Booked revenue is not collected revenue, and collected revenue is
            not profit. Estimated gross margin is only shown when this campaign
            is linked to a departure with real costing data — otherwise it reads
            &quot;Not available&quot; rather than a guess.
          </p>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Spend log</h3>
            {canEditSpend && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSpendOpen(true)}
              >
                <Plus /> Record Spend
              </Button>
            )}
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {spend.length === 0 ? (
              <EmptyState title="No spend recorded yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Date", "Amount", "Note", "Recorded by"].map((label) => (
                      <TableHead
                        key={label}
                        className="h-9 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {spend.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {formatDate(s.spent_on)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(s.amount)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {s.note ?? "—"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {s.created_by_name}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === "audience" && (
        <div className="flex flex-col gap-4">
          {canManage && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAudienceSuggestOpen(true)}
              >
                <Sparkles /> Suggest Audience
              </Button>
            </div>
          )}
          {!audienceEligibility ? (
            <EmptyState
              title="No audience linked"
              description="Link a saved Audience to this campaign to see who is eligible to be contacted and why others are excluded, or let Manasik Marketing Intelligence suggest one."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <KpiCard
                  title="Audience"
                  value={audienceEligibility.audienceName}
                />
                <KpiCard
                  title="Total in audience"
                  value={String(audienceEligibility.totalSubjects)}
                />
                <KpiCard
                  title="Eligible"
                  value={String(audienceEligibility.eligibleCount)}
                />
                <KpiCard
                  title="Excluded"
                  value={String(audienceEligibility.excludedCount)}
                />
              </div>

              {audienceEligibility.exclusionReasons.length > 0 && (
                <Card className="p-4 flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Why people were excluded
                  </h3>
                  {audienceEligibility.exclusionReasons.map((r) => (
                    <p key={r.reason} className="text-xs text-foreground">
                      <span className="tabular-nums">{r.count}</span>{" "}
                      <span className="text-muted-foreground">
                        — {r.reason}
                      </span>
                    </p>
                  ))}
                </Card>
              )}

              <Card className="p-0 overflow-x-auto no-scrollbar">
                {audienceEligibility.subjects.length === 0 ? (
                  <EmptyState title="Audience is empty" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-none!">
                        {["Name", "Contact", "Eligibility"].map((label) => (
                          <TableHead
                            key={label}
                            className="h-9 px-3 text-xs font-medium text-muted-foreground"
                          >
                            {label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/20">
                      {audienceEligibility.subjects.map((s) => (
                        <TableRow key={s.subjectId}>
                          <TableCell className="px-3 py-3 text-sm text-foreground">
                            {s.name}
                          </TableCell>
                          <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                            {s.contact ?? "—"}
                          </TableCell>
                          <TableCell className="px-3 py-3">
                            {s.eligible ? (
                              <ToneBadge tone="success" label="Eligible" />
                            ) : (
                              <ToneBadge
                                tone="neutral"
                                label={s.exclusionReason ?? "Excluded"}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              {audienceEligibility.totalSubjects >
                audienceEligibility.subjects.length && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {audienceEligibility.subjects.length} of{" "}
                  {audienceEligibility.totalSubjects} — totals above cover the
                  whole audience.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === "channels" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              Channel breakdown
            </h3>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChannelOpen(true)}
              >
                <Plus /> Add Channel
              </Button>
            )}
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {channels.length === 0 ? (
              <EmptyState
                title="No channels added yet"
                description="Break this campaign down by channel to compare WhatsApp, Facebook, events and referrals side by side."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Channel",
                      "Status",
                      "Budget",
                      "Spend",
                      "Leads",
                      "Qualified",
                      "Bookings",
                      "Ad platform",
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-9 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {channels.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {CHANNEL_LABELS[c.channel]}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <ChannelStatusControl
                          campaignId={campaign.id}
                          channel={c}
                          canManage={canManage}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {c.budget_allocation != null
                          ? formatExactCurrency(c.budget_allocation)
                          : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(c.metrics.spend)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {c.metrics.leadCount}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {c.metrics.qualifiedLeadCount}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {c.metrics.bookingCount}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <AdPlatformLinkControl
                          campaignId={campaign.id}
                          channel={c}
                          canManage={canManage}
                          metaAdsConnected={metaAdsConnected}
                          googleAdsConnected={googleAdsConnected}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Leads/bookings per channel come from attribution touchpoints logged
            against this campaign — a channel added here reads zero until
            something records a touchpoint for it. Spend for a channel linked to
            a connected Meta/Google Ads campaign can be synced directly instead
            of entered manually.
          </p>
        </div>
      )}

      {tab === "content" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              Content &amp; tracking assets
            </h3>
            {canManageContent && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setContentDraftOpen(true)}
                >
                  <Sparkles /> Draft with AI
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAssetOpen(true)}
                >
                  <Plus /> Add Asset
                </Button>
              </div>
            )}
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {assets.length === 0 ? (
              <EmptyState
                title="No content registered yet"
                description="Register the WhatsApp template, landing page, brochure, or QR code this campaign uses."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Asset", "Type", "Language", "Link / QR", "Added by"].map(
                      (label) => (
                        <TableHead
                          key={label}
                          className="h-9 px-3 text-xs font-medium text-muted-foreground"
                        >
                          {label}
                        </TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {a.label}
                        {a.notes && (
                          <p className="text-[11px] text-muted-foreground">
                            {a.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {ASSET_TYPE_LABELS[a.asset_type]}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {a.language ?? "—"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {a.url ?? a.qr_code_value ?? "—"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {a.created_by_name}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === "experiments" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Experiments</h3>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExperimentOpen(true)}
              >
                <Plus /> New Experiment
              </Button>
            )}
          </div>
          {experiments.length === 0 ? (
            <EmptyState
              title="No experiments yet"
              description="Compare two offers, messages or audiences systematically — e.g. twin-room vs quad-room messaging."
            />
          ) : (
            experiments.map((exp) => (
              <ExperimentCard
                key={exp.id}
                campaignId={campaign.id}
                experiment={exp}
                canManage={canManage}
              />
            ))
          )}
        </div>
      )}

      {tab === "attribution" && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              Weighted (time-decay) attribution
            </h3>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Each booking&apos;s collected revenue is split across its
              touchpoints by recency — a touch closer to the booking date counts
              for more. Summing this column across channels never exceeds the
              campaign&apos;s real collected revenue. Reads empty until
              touchpoints with a booking_id exist for this campaign.
            </p>
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {weightedAttribution.length === 0 ? (
              <EmptyState
                title="No weighted attribution yet"
                description="Needs campaign_touchpoints linked to a booking."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Channel",
                      "Touches",
                      "Weighted bookings",
                      "Weighted collected revenue",
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-9 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {weightedAttribution.map((row) => (
                    <TableRow key={row.channel ?? "unknown"}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {row.channel ?? "Unknown"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {row.touchCount}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {row.weightedBookings.toFixed(2)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(row.weightedCollectedRevenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
              Touchpoints
            </h3>
            <Tabs
              value={attributionTouchType}
              onValueChange={(v) =>
                setAttributionTouchType(v as "FIRST" | "LAST" | "ASSISTED")
              }
            >
              <TabsList>
                <TabsTrigger value="FIRST">First touch</TabsTrigger>
                <TabsTrigger value="LAST">Last touch</TabsTrigger>
                <TabsTrigger value="ASSISTED">Assisted</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <TouchpointTable
            rows={
              attributionTouchType === "FIRST"
                ? firstTouches
                : attributionTouchType === "LAST"
                  ? lastTouches
                  : assistedTouches
            }
          />
        </div>
      )}

      {tab === "ai" && (
        <div className="flex flex-col gap-3">
          {insights.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" />}
              title="No diagnosis yet"
              description="Manasik Marketing Intelligence surfaces a diagnosis here once this campaign has enough leads, quotes or bookings to reason about."
            />
          ) : (
            insights.map((insight) => (
              <CampaignInsightCard
                key={insight.id}
                campaignId={campaign.id}
                insight={insight}
                canAct={canActOnDiagnosis}
              />
            ))
          )}
        </div>
      )}

      <RecordSpendDialog
        campaignId={campaign.id}
        open={spendOpen}
        onClose={() => setSpendOpen(false)}
      />
      <AddChannelDialog
        campaignId={campaign.id}
        open={channelOpen}
        onClose={() => setChannelOpen(false)}
        existingChannels={channels.map((c) => c.channel)}
      />
      <AddContentAssetDialog
        campaignId={campaign.id}
        open={assetOpen}
        onClose={() => setAssetOpen(false)}
        whatsappTemplateOptions={whatsappTemplateOptions}
      />
      <CreateExperimentDialog
        campaignId={campaign.id}
        open={experimentOpen}
        onClose={() => setExperimentOpen(false)}
      />
      <AudienceSuggestDialog
        campaignId={campaign.id}
        open={audienceSuggestOpen}
        onClose={() => setAudienceSuggestOpen(false)}
      />
      <ContentDraftDialog
        campaignId={campaign.id}
        open={contentDraftOpen}
        onClose={() => setContentDraftOpen(false)}
      />
      <AddTrackingAssetDialog
        campaignId={campaign.id}
        open={trackingAssetOpen}
        onClose={() => setTrackingAssetOpen(false)}
      />
    </div>
  );
}

const TRACKING_ASSET_TYPE_LABELS: Record<"QR_CODE" | "TRACKING_LINK", string> =
  {
    QR_CODE: "QR code",
    TRACKING_LINK: "Tracking link",
  };

/**
 * Lists this campaign's click-to-chat tracking codes and QR codes — the
 * `campaign_assets` rows that make automatic WhatsApp attribution possible
 * (see lib/whatsapp/campaign-attribution.ts). A code only earns a HIGH-
 * confidence touchpoint when a customer's opening WhatsApp message contains
 * it verbatim, so the tip here is not decorative — it's the actual
 * requirement for attribution to fire.
 */
function TrackingAssetsCard({
  assets,
  canManageContent,
  onAdd,
}: {
  assets: CampaignAssetRow[];
  canManageContent: boolean;
  onAdd: () => void;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Tracking Links &amp; QR Codes
          </h3>
          <p className="text-xs text-muted-foreground">
            A WhatsApp reply that includes one of these codes is attributed to
            this campaign automatically.
          </p>
        </div>
        {canManageContent && (
          <Button size="sm" variant="ghost" onClick={onAdd}>
            <Plus /> Add Tracking Code
          </Button>
        )}
      </div>
      {assets.length === 0 ? (
        <EmptyState
          title="No tracking codes yet"
          description="Add one to attribute WhatsApp click-to-chat replies to this campaign automatically."
        />
      ) : (
        <div className="flex flex-col divide-y divide-border/20">
          {assets.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm text-foreground">
                  {a.label}{" "}
                  <span className="text-muted-foreground">
                    ·{" "}
                    {
                      TRACKING_ASSET_TYPE_LABELS[
                        a.asset_type as "QR_CODE" | "TRACKING_LINK"
                      ]
                    }
                  </span>
                </p>
                {a.qr_code_value && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {a.qr_code_value}
                  </p>
                )}
                {a.url && (
                  <p className="text-xs text-muted-foreground break-all">
                    {a.url}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AddTrackingAssetDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [assetType, setAssetType] = useState<"QR_CODE" | "TRACKING_LINK">(
    "TRACKING_LINK",
  );
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAssetType("TRACKING_LINK");
    setLabel("");
    setCode("");
    setUrl("");
    setError(null);
  };

  const submit = async () => {
    if (!label.trim()) {
      setError("Give this tracking code a label.");
      return;
    }
    if (!code.trim()) {
      setError(
        "Set the code customers will include in their message — this is what makes attribution work.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await addCampaignAssetAction({
      campaignId,
      assetType,
      referenceId: null,
      label: label.trim(),
      language: null,
      url: url.trim() || null,
      qrCodeValue: code.trim(),
      notes: null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add this tracking code.");
      return;
    }
    toast.add({ title: "Tracking code added" });
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Add Tracking Code</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Type
            </label>
            <Select
              value={assetType}
              onValueChange={(v) =>
                setAssetType(v as "QR_CODE" | "TRACKING_LINK")
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TRACKING_LINK">
                  Tracking link (click-to-chat)
                </SelectItem>
                <SelectItem value="QR_CODE">QR code</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <InputGroupField
            label="Label *"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Ramadan QR — Colombo branch"
          />
          <div className="flex flex-col gap-1.5">
            <InputGroupField
              label="Code *"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. RAMADAN26-QR1"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Customers must include this exact code in their opening WhatsApp
              message for it to be matched — add it to the click-to-chat
              link&apos;s prefilled text, or print it under the QR code.
            </p>
          </div>
          <InputGroupField
            label={
              assetType === "QR_CODE"
                ? "Link the QR points to (optional)"
                : "wa.me link (optional)"
            }
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://wa.me/94771234567?text=..."
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add Tracking Code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TouchpointTable({ rows }: { rows: CampaignTouchpointRow[] }) {
  if (rows.length === 0)
    return <EmptyState title="No touchpoints of this kind yet" />;
  return (
    <Card className="p-0 overflow-x-auto no-scrollbar">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-none!">
            {["Channel", "Source", "Confidence", "Occurred"].map((label) => (
              <TableHead
                key={label}
                className="h-9 px-3 text-xs font-medium text-muted-foreground"
              >
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-border/20">
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="px-3 py-3 text-sm text-foreground">
                {r.channel ?? "—"}
              </TableCell>
              <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                {r.source_detail ?? r.tracking_code ?? "—"}
              </TableCell>
              <TableCell className="px-3 py-3">
                <ToneBadge
                  tone={
                    r.attribution_confidence === "HIGH"
                      ? "success"
                      : r.attribution_confidence === "MEDIUM"
                        ? "warning"
                        : "neutral"
                  }
                  label={r.attribution_confidence}
                />
              </TableCell>
              <TableCell className="px-3 py-3 text-xs text-foreground">
                {formatDate(r.occurred_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AdPlatformLinkControl({
  campaignId,
  channel,
  canManage,
  metaAdsConnected,
  googleAdsConnected,
}: {
  campaignId: string;
  channel: CampaignChannelWithMetrics;
  canManage: boolean;
  metaAdsConnected: boolean;
  googleAdsConnected: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const platformAvailable = metaAdsConnected || googleAdsConnected;
  if (!canManage || !platformAvailable) {
    return channel.external_campaign_id ? (
      <span className="text-xs text-muted-foreground">
        {channel.external_platform} · {channel.external_campaign_id}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }

  const sync = async () => {
    if (!channel.external_platform || !channel.external_campaign_id) return;
    setSyncing(true);
    const until = colomboDayKey();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await syncCampaignChannelSpendAction({
      campaignId,
      channelId: channel.id,
      platform: channel.external_platform as "META_ADS" | "GOOGLE_ADS",
      externalCampaignId: channel.external_campaign_id,
      since,
      until,
    });
    setSyncing(false);
    if (!result.ok) {
      toast.add({ title: "Sync failed", description: result.error });
      return;
    }
    toast.add({ title: "Spend synced" });
  };

  return (
    <div className="flex items-center gap-1.5">
      {channel.external_campaign_id ? (
        <>
          <span className="text-xs text-muted-foreground">
            {channel.external_platform} · {channel.external_campaign_id}
          </span>
          <Button size="xs" variant="ghost" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        </>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => setLinkOpen(true)}>
          Link
        </Button>
      )}
      <LinkAdPlatformDialog
        campaignId={campaignId}
        channelId={channel.id}
        channelType={channel.channel}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        metaAdsConnected={metaAdsConnected}
        googleAdsConnected={googleAdsConnected}
      />
    </div>
  );
}

function LinkAdPlatformDialog({
  campaignId,
  channelId,
  channelType,
  open,
  onClose,
  metaAdsConnected,
  googleAdsConnected,
}: {
  campaignId: string;
  channelId: string;
  channelType: CampaignChannel;
  open: boolean;
  onClose: () => void;
  metaAdsConnected: boolean;
  googleAdsConnected: boolean;
}) {
  const defaultPlatform: "META_ADS" | "GOOGLE_ADS" =
    channelType === "GOOGLE" && googleAdsConnected
      ? "GOOGLE_ADS"
      : metaAdsConnected
        ? "META_ADS"
        : "GOOGLE_ADS";
  const [platform, setPlatform] = useState<"META_ADS" | "GOOGLE_ADS">(
    defaultPlatform,
  );
  const [options, setOptions] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = async (nextPlatform: "META_ADS" | "GOOGLE_ADS") => {
    setLoading(true);
    setError(null);
    const result = await listAdPlatformCampaignsAction(nextPlatform);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setOptions([]);
      return;
    }
    setOptions(result.campaigns);
  };

  const submit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    const result = await linkCampaignChannelExternalCampaignAction({
      campaignId,
      channelId,
      platform,
      externalCampaignId: selectedId,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not link this channel.");
      return;
    }
    toast.add({ title: "Channel linked" });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) loadOptions(platform);
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Link to Ad Platform Campaign</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {metaAdsConnected && googleAdsConnected && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Platform
              </label>
              <Select
                value={platform}
                onValueChange={(v) => {
                  const next = v as "META_ADS" | "GOOGLE_ADS";
                  setPlatform(next);
                  setSelectedId("");
                  loadOptions(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="META_ADS">Meta Ads</SelectItem>
                  <SelectItem value="GOOGLE_ADS">Google Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Campaign
            </label>
            <Select
              value={selectedId}
              onValueChange={(v) => setSelectedId(v ?? "")}
              disabled={loading || options.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loading
                      ? "Loading…"
                      : options.length === 0
                        ? "No campaigns found"
                        : "Choose a campaign…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} ({o.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !selectedId}>
            {submitting ? "Linking…" : "Link Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AudienceSuggestDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    rationale: string;
    proposal: AudienceProposalFilters;
    liveCount: number;
    source: "RULES" | "LLM";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audienceName, setAudienceName] = useState("");
  const [creating, setCreating] = useState(false);

  const suggest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const outcome = await suggestCampaignAudienceAction(campaignId);
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setResult(outcome);
    setAudienceName(`AI suggestion — ${new Date().toLocaleDateString()}`);
  };

  const create = async () => {
    if (!result) return;
    setCreating(true);
    const outcome = await createAudienceFromCampaignProposalAction({
      campaignId,
      name: audienceName,
      proposal: result.proposal,
    });
    setCreating(false);
    if (!outcome.ok) {
      toast.add({
        title: "Could not create audience",
        description: outcome.error,
      });
      return;
    }
    toast.add({ title: "Audience created and linked" });
    onClose();
    setResult(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && !result && !loading) suggest();
        if (!next) {
          onClose();
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Suggest Audience</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {loading && (
            <p className="text-xs text-muted-foreground">Thinking…</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {result && (
            <>
              <p className="text-sm text-foreground">{result.rationale}</p>
              <div className="rounded-sm border border-border p-2.5 text-xs text-muted-foreground">
                <p>Subject: {result.proposal.subjectType}</p>
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(result.proposal.filters, null, 2)}
                </pre>
              </div>
              <KpiCard title="Live count" value={String(result.liveCount)} />
              {result.source === "RULES" && (
                <p className="text-[11px] text-muted-foreground">
                  Draft-only fallback — no live model responded.
                </p>
              )}
              <InputGroupField
                label="Name this audience"
                value={audienceName}
                onChange={(e) => setAudienceName(e.target.value)}
              />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {result && (
            <Button
              onClick={create}
              disabled={creating || !audienceName.trim()}
            >
              {creating ? "Creating…" : "Create Audience From This"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContentDraftDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<"English" | "Tamil" | "Sinhala">(
    "English",
  );
  const [tone, setTone] = useState<"WARM" | "PROFESSIONAL" | "SHORT_WHATSAPP">(
    "WARM",
  );
  const [loading, setLoading] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = async () => {
    setLoading(true);
    setError(null);
    setDraftText(null);
    const outcome = await draftCampaignContentAction({
      campaignId,
      language,
      tone,
    });
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setDraftText(outcome.draftText);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setDraftText(null);
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Draft Content with AI</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Language
              </label>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(v as typeof language)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Tamil">Tamil</SelectItem>
                  <SelectItem value="Sinhala">Sinhala</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tone
              </label>
              <Select
                value={tone}
                onValueChange={(v) => setTone(v as typeof tone)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WARM">Warm</SelectItem>
                  <SelectItem value="PROFESSIONAL">Professional</SelectItem>
                  <SelectItem value="SHORT_WHATSAPP">
                    Short (WhatsApp)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {draftText && (
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={6}
              className="text-sm"
            />
          )}
          {draftText && (
            <p className="text-[11px] text-muted-foreground">
              Draft only — nothing is sent. Copy this into a WhatsApp template
              submission or a Content asset yourself.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={draft} disabled={loading}>
            {loading ? "Drafting…" : draftText ? "Redraft" : "Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelStatusControl({
  campaignId,
  channel,
  canManage,
}: {
  campaignId: string;
  channel: CampaignChannelWithMetrics;
  canManage: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);

  if (!canManage) {
    return (
      <ToneBadge
        tone={channel.status === "ACTIVE" ? "success" : "neutral"}
        label={channel.status}
      />
    );
  }

  const cycle: Record<CampaignChannelStatus, CampaignChannelStatus> = {
    ACTIVE: "PAUSED",
    PAUSED: "ACTIVE",
    ENDED: "ENDED",
  };

  const toggle = async () => {
    setSubmitting(true);
    const result = await updateCampaignChannelStatusAction({
      campaignId,
      channelId: channel.id,
      status: cycle[channel.status],
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.add({
        title: "Could not update channel",
        description: result.error,
      });
      return;
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={submitting || channel.status === "ENDED"}
      className="cursor-pointer disabled:cursor-default"
    >
      <ToneBadge
        tone={channel.status === "ACTIVE" ? "success" : "neutral"}
        label={channel.status}
      />
    </button>
  );
}

function ExperimentCard({
  campaignId,
  experiment,
  canManage,
}: {
  campaignId: string;
  experiment: CampaignExperimentWithVariants;
  canManage: boolean;
}) {
  const [decision, setDecision] = useState(experiment.decision ?? "");
  const [submitting, setSubmitting] = useState(false);

  const changeStatus = async (status: CampaignExperimentStatus) => {
    setSubmitting(true);
    const result = await updateCampaignExperimentAction({
      campaignId,
      experimentId: experiment.id,
      status,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.add({
        title: "Could not update experiment",
        description: result.error,
      });
      return;
    }
  };

  const saveDecision = async () => {
    setSubmitting(true);
    const result = await updateCampaignExperimentAction({
      campaignId,
      experimentId: experiment.id,
      decision,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.add({
        title: "Could not save decision",
        description: result.error,
      });
      return;
    }
    toast.add({ title: "Decision saved" });
  };

  const STATUS_TONE_EXP: Record<CampaignExperimentStatus, Tone> = {
    DRAFT: "neutral",
    RUNNING: "info",
    COMPLETE: "success",
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ToneBadge
          tone={STATUS_TONE_EXP[experiment.status]}
          label={experiment.status}
        />
        <span className="text-xs text-muted-foreground">
          Primary metric: {experiment.primary_metric}
        </span>
      </div>
      <p className="text-sm text-foreground">{experiment.hypothesis}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {experiment.variants.map((v) => (
          <div
            key={v.id}
            className="rounded-sm border border-border p-2.5 flex flex-col gap-1"
          >
            <p className="text-xs font-medium text-foreground">
              Variant {v.variant_label}
              {v.audience_split_pct != null && (
                <span className="text-muted-foreground">
                  {" "}
                  · {v.audience_split_pct}% split
                </span>
              )}
            </p>
            {v.description && (
              <p className="text-xs text-muted-foreground">{v.description}</p>
            )}
            {v.result_summary && (
              <p className="text-xs text-foreground">
                Result: {v.result_summary}
              </p>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {experiment.status === "DRAFT" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={submitting}
                onClick={() => changeStatus("RUNNING")}
              >
                Start
              </Button>
            )}
            {experiment.status === "RUNNING" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={submitting}
                onClick={() => changeStatus("COMPLETE")}
              >
                Mark Complete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="Decision — what did we learn?"
              className="text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={saveDecision}
            >
              Save
            </Button>
          </div>
        </div>
      )}
      {!canManage && experiment.decision && (
        <p className="text-xs text-foreground">
          Decision: {experiment.decision}
        </p>
      )}
    </Card>
  );
}

function AddChannelDialog({
  campaignId,
  open,
  onClose,
  existingChannels,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  existingChannels: CampaignChannel[];
}) {
  const availableChannels = (
    Object.keys(CHANNEL_LABELS) as CampaignChannel[]
  ).filter((c) => !existingChannels.includes(c));
  const [channel, setChannel] = useState<CampaignChannel>(
    availableChannels[0] ?? "WHATSAPP",
  );
  const [budgetAllocation, setBudgetAllocation] = useState(0);
  const [trackingLink, setTrackingLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await addCampaignChannelAction({
      campaignId,
      channel,
      budgetAllocation: budgetAllocation > 0 ? budgetAllocation : null,
      trackingLink: trackingLink || null,
      assetId: null,
      notes: null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add this channel.");
      return;
    }
    toast.add({ title: "Channel added" });
    setBudgetAllocation(0);
    setTrackingLink("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Add Channel</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Channel
            </label>
            <Select
              value={channel}
              onValueChange={(v) => setChannel(v as CampaignChannel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNEL_LABELS) as CampaignChannel[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Budget allocation (optional)
            </label>
            <CurrencyInput
              value={budgetAllocation}
              onValueChange={(v) => setBudgetAllocation(v === "" ? 0 : v)}
            />
          </div>
          <InputGroupField
            label="Tracking link (optional)"
            value={trackingLink}
            onChange={(e) => setTrackingLink(e.target.value)}
            placeholder="https://…"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddContentAssetDialog({
  campaignId,
  open,
  onClose,
  whatsappTemplateOptions,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  whatsappTemplateOptions: WhatsAppTemplateOption[];
}) {
  const [assetType, setAssetType] =
    useState<CampaignAssetType>("MESSAGE_TEMPLATE");
  const [label, setLabel] = useState("");
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [url, setUrl] = useState("");
  const [qrCodeValue, setQrCodeValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await addCampaignAssetAction({
      campaignId,
      assetType,
      referenceId: assetType === "MESSAGE_TEMPLATE" ? referenceId : null,
      label: label.trim(),
      language: language || null,
      url: url || null,
      qrCodeValue: qrCodeValue || null,
      notes: null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add this asset.");
      return;
    }
    toast.add({ title: "Asset added" });
    setLabel("");
    setReferenceId(null);
    setLanguage("");
    setUrl("");
    setQrCodeValue("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Add Content Asset</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Type
            </label>
            <Select
              value={assetType}
              onValueChange={(v) => setAssetType(v as CampaignAssetType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ASSET_TYPE_LABELS) as CampaignAssetType[]).map(
                  (t) => (
                    <SelectItem key={t} value={t}>
                      {ASSET_TYPE_LABELS[t]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {assetType === "MESSAGE_TEMPLATE" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Approved WhatsApp template
              </label>
              <Select
                value={referenceId ?? ""}
                onValueChange={(v) => {
                  setReferenceId(v);
                  const t = whatsappTemplateOptions.find((o) => o.id === v);
                  if (t) {
                    setLabel(t.name);
                    setLanguage(t.language);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template…" />
                </SelectTrigger>
                <SelectContent>
                  {whatsappTemplateOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No approved templates yet
                    </div>
                  ) : (
                    whatsappTemplateOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.language})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <InputGroupField
              label="Label *"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Ramadan brochure — Tamil"
            />
          )}

          {(assetType === "LANDING_PAGE" ||
            assetType === "TRACKING_LINK" ||
            assetType === "BROCHURE" ||
            assetType === "CREATIVE") && (
            <InputGroupField
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          )}
          {assetType === "QR_CODE" && (
            <InputGroupField
              label="QR code value"
              value={qrCodeValue}
              onChange={(e) => setQrCodeValue(e.target.value)}
              placeholder="e.g. CAM-RAM-2027-CMB-01"
            />
          )}
          {assetType !== "MESSAGE_TEMPLATE" && (
            <InputGroupField
              label="Language (optional)"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="e.g. Tamil"
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !label.trim() ||
              (assetType === "MESSAGE_TEMPLATE" && !referenceId)
            }
          >
            {submitting ? "Adding…" : "Add Asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateExperimentDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [hypothesis, setHypothesis] = useState("");
  const [primaryMetric, setPrimaryMetric] = useState("");
  const [variantADescription, setVariantADescription] = useState("");
  const [variantBDescription, setVariantBDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createCampaignExperimentAction({
      campaignId,
      hypothesis: hypothesis.trim(),
      primaryMetric: primaryMetric.trim(),
      variants: [
        {
          variantLabel: "A",
          description: variantADescription || null,
          audienceSplitPct: null,
        },
        {
          variantLabel: "B",
          description: variantBDescription || null,
          audienceSplitPct: null,
        },
      ],
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create this experiment.");
      return;
    }
    toast.add({ title: "Experiment created" });
    setHypothesis("");
    setPrimaryMetric("");
    setVariantADescription("");
    setVariantBDescription("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>New Experiment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Hypothesis *
            </label>
            <Textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              rows={2}
              placeholder="e.g. Instalment messaging converts better than a flat discount"
            />
          </div>
          <InputGroupField
            label="Primary success metric *"
            value={primaryMetric}
            onChange={(e) => setPrimaryMetric(e.target.value)}
            placeholder="e.g. Quote-to-booking rate"
          />
          <div className="grid grid-cols-2 gap-3">
            <InputGroupField
              label="Variant A"
              value={variantADescription}
              onChange={(e) => setVariantADescription(e.target.value)}
              placeholder="Description"
            />
            <InputGroupField
              label="Variant B"
              value={variantBDescription}
              onChange={(e) => setVariantBDescription(e.target.value)}
              placeholder="Description"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !hypothesis.trim() || !primaryMetric.trim()}
          >
            {submitting ? "Creating…" : "Create Experiment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignInsightCard({
  campaignId,
  insight,
  canAct,
}: {
  campaignId: string;
  insight: InsightWithEvidence;
  canAct: boolean;
}) {
  const [submitting, setSubmitting] = useState<InsightOutcomeType | null>(null);

  const act = async (outcomeType: InsightOutcomeType) => {
    setSubmitting(outcomeType);
    const result = await recordCampaignInsightOutcomeAction({
      campaignId,
      insightId: insight.id,
      outcomeType,
    });
    setSubmitting(null);
    if (!result.ok) {
      toast.add({
        title: "Could not update this insight",
        description: result.error,
      });
      return;
    }
    toast.add({ title: "Diagnosis updated" });
  };

  const isTerminal =
    insight.status === "DISMISSED" || insight.status === "RESOLVED";

  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ToneBadge
          tone={SEVERITY_TONE[insight.severity]}
          label={insight.severity}
        />
        <span className="text-xs text-muted-foreground">{insight.status}</span>
      </div>
      <p className="text-sm font-medium text-foreground">{insight.title}</p>
      <p className="text-sm text-muted-foreground">{insight.description}</p>
      {insight.evidence.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {insight.evidence.map((e) => (
            <p key={e.id} className="text-xs text-foreground">
              <span className="text-muted-foreground">{e.label}:</span>{" "}
              {e.detail}
            </p>
          ))}
        </div>
      )}
      {canAct && !isTerminal && (
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!!submitting}
            onClick={() => act("ACKNOWLEDGED")}
          >
            Acknowledge
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!submitting}
            onClick={() => act("ACTED_ON")}
          >
            Mark Acted On
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!submitting}
            onClick={() => act("RESOLVED")}
          >
            Resolve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!submitting}
            onClick={() => act("DISMISSED")}
          >
            Dismiss
          </Button>
        </div>
      )}
    </Card>
  );
}

function RecordSpendDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [spentOn, setSpentOn] = useState(() => colomboDayKey());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await addCampaignSpendAction({
      campaignId,
      amount,
      spentOn,
      note,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record this spend.");
      return;
    }
    toast.add({ title: "Spend recorded" });
    setAmount(0);
    setNote("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Record Spend</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Amount *
            </label>
            <CurrencyInput
              value={amount}
              onValueChange={(v) => setAmount(v === "" ? 0 : v)}
            />
          </div>
          <InputGroupField
            label="Date"
            type="date"
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
          />
          <InputGroupField
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Meta ads, week 3"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || amount <= 0}>
            {submitting ? "Saving…" : "Record Spend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
