"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CurrencyInput } from "@/components/ui/currency-input";
import { Megaphone, Plus } from "lucide-react";

import {
  formatDate,
  formatExactCurrency,
} from "@/app/(main)/departure-groups/utils";
import type {
  CampaignAudienceOption,
  CampaignDepartureGroupOption,
  CampaignPackageOption,
} from "@/lib/data/campaigns-repository";
import type {
  CampaignChannel,
  CampaignObjective,
  CampaignStatus,
  CampaignType,
  CampaignWithMetrics,
} from "@/lib/types/campaigns";
import { TONE_CLASS, type Tone } from "@/lib/ui/tone";

import { createCampaignAction } from "../actions";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DatePicker } from "@/components/date-time-picker";

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

export const CHANNEL_LABELS: Record<CampaignChannel, string> = {
  WHATSAPP: "WhatsApp",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  GOOGLE: "Google",
  WEBSITE: "Website",
  REFERRAL: "Referral",
  WALK_IN: "Walk-in",
  EVENT: "Event",
  PARTNER: "Partner",
  OTHER: "Other",
};

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  PACKAGE_LAUNCH: "Package Launch",
  DEPARTURE_FILL: "Departure Fill",
  RAMADAN_UMRAH: "Ramadan Umrah",
  HAJJ_PRE_REGISTRATION: "Hajj Pre-registration",
  HAJJ_EDUCATION: "Hajj Education",
  EARLY_BIRD: "Early-Bird Offer",
  SCHOOL_HOLIDAY_UMRAH: "School Holiday Umrah",
  FAMILY_UMRAH: "Family Umrah",
  WOMENS_GROUP_UMRAH: "Women's Group Umrah",
  SENIOR_FRIENDLY_UMRAH: "Senior-Friendly Umrah",
  REFERRAL_PROGRAM: "Referral Program",
  PAST_PILGRIM_REACTIVATION: "Past Pilgrim Reactivation",
  VISA_DOCUMENT_DEADLINE: "Visa / Document Deadline",
  EVENT_ROADSHOW: "Event / Mosque Roadshow",
  PARTNER_AGENT: "Partner / Agent Campaign",
  CONTENT_EDUCATION: "Content / Education Campaign",
  CUSTOM: "Custom",
};

export const CAMPAIGN_OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  GENERATE_ENQUIRIES: "Generate enquiries",
  GENERATE_QUALIFIED_LEADS: "Generate qualified leads",
  GENERATE_QUOTES: "Generate quotes",
  GENERATE_BOOKINGS: "Generate confirmed bookings",
  COLLECT_DEPOSITS: "Collect deposits",
  COLLECT_FULL_PAYMENT: "Collect full payment",
  FILL_DEPARTURE: "Fill a particular departure",
  REACTIVATE_PAST_PILGRIMS: "Reactivate past pilgrims",
  GENERATE_REFERRALS: "Generate referrals",
  PROMOTE_EVENT: "Promote an event",
  INCREASE_REPEAT_BOOKINGS: "Increase repeat Umrah bookings",
};

type SavedView =
  | "ALL"
  | "ACTIVE"
  | "UPCOMING"
  | "FILLING_DEPARTURES"
  | "HAJJ"
  | "RAMADAN"
  | "REFERRAL"
  | "REACTIVATION"
  | "AT_RISK"
  | "COMPLETED"
  | "ARCHIVED";

const SAVED_VIEW_LABELS: Record<SavedView, string> = {
  ALL: "All",
  ACTIVE: "Active",
  UPCOMING: "Upcoming",
  FILLING_DEPARTURES: "Filling Departures",
  HAJJ: "Hajj Campaigns",
  RAMADAN: "Ramadan Campaigns",
  REFERRAL: "Referral Campaigns",
  REACTIVATION: "Past-Pilgrim Reactivation",
  AT_RISK: "At Risk",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

function matchesSavedView(c: CampaignWithMetrics, view: SavedView): boolean {
  switch (view) {
    case "ALL":
      return true;
    case "ACTIVE":
      return c.status === "ACTIVE";
    case "UPCOMING":
      return c.status === "SCHEDULED";
    case "FILLING_DEPARTURES":
      return !!c.linked_departure_group_id && c.status === "ACTIVE";
    case "HAJJ":
      return (
        c.campaign_type === "HAJJ_PRE_REGISTRATION" ||
        c.campaign_type === "HAJJ_EDUCATION"
      );
    case "RAMADAN":
      return c.campaign_type === "RAMADAN_UMRAH";
    case "REFERRAL":
      return c.campaign_type === "REFERRAL_PROGRAM";
    case "REACTIVATION":
      return c.campaign_type === "PAST_PILGRIM_REACTIVATION";
    case "AT_RISK":
      return (
        (c.capacity != null &&
          (c.capacity.salesStatus === "SALES_CLOSED" ||
            c.capacity.availableSeats === 0)) ||
        (c.budget != null &&
          c.budget > 0 &&
          c.metrics.totalSpend / c.budget >= 0.9 &&
          c.metrics.bookingCount === 0)
      );
    case "COMPLETED":
      return c.status === "COMPLETED";
    case "ARCHIVED":
      return c.status === "ARCHIVED";
    default:
      return true;
  }
}

interface CampaignsListViewProps {
  campaigns: CampaignWithMetrics[];
  canManage: boolean;
  packageOptions: CampaignPackageOption[];
  departureGroupOptions: CampaignDepartureGroupOption[];
  audienceOptions: CampaignAudienceOption[];
}

export default function CampaignsListView({
  campaigns,
  canManage,
  packageOptions,
  departureGroupOptions,
  audienceOptions,
}: CampaignsListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<SavedView>("ALL");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (!matchesSavedView(c, view)) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle);
    });
  }, [campaigns, search, view]);

  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const totalSpend = campaigns.reduce(
    (sum, c) => sum + c.metrics.totalSpend,
    0,
  );
  const totalRevenue = campaigns.reduce((sum, c) => sum + c.metrics.revenue, 0);
  const totalLeads = campaigns.reduce((sum, c) => sum + c.metrics.leadCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        breadcrumb={[
          { title: "Grow", link: "#" },
          { title: "Campaigns", link: "/campaigns" },
        ]}
        subTitle="Demand-generation plays that fill real, profitable departures — tracked from lead through quote, booking, and collected revenue."
        action={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New Campaign
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Active campaigns" value={String(activeCount)} />
        <KpiCard title="Attributed leads" value={String(totalLeads)} />
        <KpiCard title="Total spend" value={formatExactCurrency(totalSpend)} />
        <KpiCard
          title="Attributed revenue"
          value={formatExactCurrency(totalRevenue)}
        />
      </div>

      <Tabs
        value={view}
        onValueChange={(value: string) => setView(value as SavedView)}
      >
        <TabsList>
          {(Object.keys(SAVED_VIEW_LABELS) as SavedView[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {SAVED_VIEW_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search campaigns…"
        rowCount={filtered.length}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-8" />}
            title="No campaigns found"
            description={
              canManage
                ? "Create the first campaign to start tracking attribution."
                : "Try a different search or view."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Campaign",
                  "Type",
                  "Departure / Seats",
                  "Leads",
                  "Qualified",
                  "Quotes",
                  "Bookings",
                  "Revenue",
                  "Collected",
                  "Spend",
                  "Cost / Booking",
                  "Status",
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
              {filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/campaigns/${c.id}`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {CHANNEL_LABELS[c.channel]}
                      {(c.start_date || c.end_date) && (
                        <>
                          {" · "}
                          {c.start_date ? formatDate(c.start_date) : "—"} –{" "}
                          {c.end_date ? formatDate(c.end_date) : "—"}
                        </>
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {CAMPAIGN_TYPE_LABELS[c.campaign_type]}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {c.capacity ? (
                      <>
                        <p>{c.capacity.groupName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {c.capacity.availableSeats} of {c.capacity.capacity}{" "}
                          seats left
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {c.metrics.leadCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {c.metrics.qualifiedLeadCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {c.metrics.quoteCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {c.metrics.bookingCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {formatExactCurrency(c.metrics.revenue)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {formatExactCurrency(c.metrics.collected)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-muted-foreground">
                    {formatExactCurrency(c.metrics.totalSpend)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {c.metrics.costPerBooking != null
                      ? formatExactCurrency(c.metrics.costPerBooking)
                      : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge
                      tone={STATUS_TONE[c.status]}
                      label={STATUS_LABELS[c.status]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>

      <CreateCampaignDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        packageOptions={packageOptions}
        departureGroupOptions={departureGroupOptions}
        audienceOptions={audienceOptions}
      />
    </div>
  );
}

function CreateCampaignDialog({
  open,
  onClose,
  packageOptions,
  departureGroupOptions,
  audienceOptions,
}: {
  open: boolean;
  onClose: () => void;
  packageOptions: CampaignPackageOption[];
  departureGroupOptions: CampaignDepartureGroupOption[];
  audienceOptions: CampaignAudienceOption[];
}) {
  const router = useRouter();
  // Goal
  const [name, setName] = useState("");
  const [campaignType, setCampaignType] = useState<CampaignType>("CUSTOM");
  const [objective, setObjective] =
    useState<CampaignObjective>("GENERATE_ENQUIRIES");
  const [channel, setChannel] = useState<CampaignChannel>("WHATSAPP");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  // Offer
  const [linkedPackageId, setLinkedPackageId] = useState<string | null>(null);
  const [linkedDepartureGroupId, setLinkedDepartureGroupId] = useState<
    string | null
  >(null);
  const [bookingCutoffAt, setBookingCutoffAt] = useState("");
  const [targetBookings, setTargetBookings] = useState(0);
  const [targetSeats, setTargetSeats] = useState(0);
  // Audience
  const [audienceId, setAudienceId] = useState<string | null>(null);
  // Budget
  const [budget, setBudget] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup =
    departureGroupOptions.find((g) => g.id === linkedDepartureGroupId) ?? null;

  const reset = () => {
    setName("");
    setCampaignType("CUSTOM");
    setObjective("GENERATE_ENQUIRIES");
    setChannel("WHATSAPP");
    setStartDate("");
    setEndDate("");
    setNotes("");
    setLinkedPackageId(null);
    setLinkedDepartureGroupId(null);
    setBookingCutoffAt("");
    setTargetBookings(0);
    setTargetSeats(0);
    setAudienceId(null);
    setBudget(0);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createCampaignAction({
      name,
      channel,
      campaignType,
      objective,
      linkedPackageId,
      linkedDepartureGroupId,
      audienceId,
      startDate: startDate || null,
      endDate: endDate || null,
      bookingCutoffAt: bookingCutoffAt || null,
      budget: budget > 0 ? budget : null,
      targetLeads: null,
      targetQualifiedLeads: null,
      targetQuotes: null,
      targetBookings: targetBookings > 0 ? targetBookings : null,
      targetSeats: targetSeats > 0 ? targetSeats : null,
      targetCollectedRevenue: null,
      targetMarginPct: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      notes: notes || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the campaign.");
      return;
    }
    if (result.warning) {
      toast.add({
        title: "Campaign created with a capacity warning",
        description: result.warning,
      });
    } else {
      toast.add({ title: "Campaign created" });
    }
    reset();
    onClose();
    if (result.campaignId) router.push(`/campaigns/${result.campaignId}`);
    else router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg! overflow-y-auto  max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 max-h-[85vh] overflow-y-auto">
          {/* Goal */}
          <section className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>
                  Name <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramadan Umrah 2027"
              />
            </InputGroup>
            <div className="grid grid-cols-2 gap-3">
              <LabeledDropdown
                label="Campaign type"
                value={CAMPAIGN_TYPE_LABELS[campaignType]}
                items={(
                  Object.keys(CAMPAIGN_TYPE_LABELS) as CampaignType[]
                ).map((t) => ({
                  key: t,
                  label: CAMPAIGN_TYPE_LABELS[t],
                }))}
                onSelect={(key) => setCampaignType(key as CampaignType)}
              />
              <LabeledDropdown
                label="Objective"
                value={CAMPAIGN_OBJECTIVE_LABELS[objective]}
                items={(
                  Object.keys(CAMPAIGN_OBJECTIVE_LABELS) as CampaignObjective[]
                ).map((o) => ({
                  key: o,
                  label: CAMPAIGN_OBJECTIVE_LABELS[o],
                }))}
                onSelect={(key) => setObjective(key as CampaignObjective)}
              />
            </div>
            <LabeledDropdown
              label="Primary channel"
              value={CHANNEL_LABELS[channel]}
              items={(Object.keys(CHANNEL_LABELS) as CampaignChannel[]).map(
                (c) => ({ key: c, label: CHANNEL_LABELS[c] }),
              )}
              onSelect={(key) => setChannel(key as CampaignChannel)}
            />
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                label="Start Date"
              />
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                label="End Date"
              />
            </div>
          </section>

          {/* Offer */}
          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Offer
            </h4>
            <LabeledDropdown
              label="Linked package"
              value={
                packageOptions.find((p) => p.id === linkedPackageId)?.title ??
                "None"
              }
              items={[
                { key: "", label: "None" },
                ...packageOptions.map((p) => ({ key: p.id, label: p.title })),
              ]}
              onSelect={(key) => setLinkedPackageId(key || null)}
            />
            <LabeledDropdown
              label="Linked departure group"
              value={
                selectedGroup
                  ? `${selectedGroup.groupName} (${selectedGroup.availableSeats} seats left)`
                  : "None"
              }
              items={[
                { key: "", label: "None" },
                ...departureGroupOptions.map((g) => ({
                  key: g.id,
                  label: `${g.groupName} — ${g.availableSeats} seats left, ${formatDate(g.departureDate)}`,
                })),
              ]}
              onSelect={(key) => setLinkedDepartureGroupId(key || null)}
            />
            {selectedGroup &&
              (selectedGroup.salesStatus === "SALES_CLOSED" ||
                selectedGroup.availableSeats === 0) && (
                <p
                  className={`text-xs rounded-sm px-2.5 py-2 ${TONE_CLASS.warning}`}
                >
                  This departure{" "}
                  {selectedGroup.availableSeats === 0
                    ? "has no seats available"
                    : "is no longer selling"}{" "}
                  — the campaign can still be saved as a draft, but should not
                  be activated yet.
                </p>
              )}
            <div className="grid grid-cols-2 gap-3">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Target bookings</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  min={0}
                  value={targetBookings || ""}
                  onChange={(e) =>
                    setTargetBookings(Number(e.target.value) || 0)
                  }
                />
              </InputGroup>
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Target seats</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  min={0}
                  value={targetSeats || ""}
                  onChange={(e) => setTargetSeats(Number(e.target.value) || 0)}
                />
              </InputGroup>
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Booking cutoff</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="date"
                value={bookingCutoffAt}
                onChange={(e) => setBookingCutoffAt(e.target.value)}
              />
            </InputGroup>
          </section>

          {/* Audience */}
          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Audience
            </h4>
            <LabeledDropdown
              label="Target audience"
              value={
                audienceOptions.find((a) => a.id === audienceId)?.name ??
                "None yet"
              }
              items={[
                { key: "", label: "None yet" },
                ...audienceOptions.map((a) => ({
                  key: a.id,
                  label: `${a.name} (${a.computedCount})`,
                })),
              ]}
              onSelect={(key) => setAudienceId(key || null)}
            />
            {audienceOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No saved audiences yet — create one under Relationships →
                Audiences, then link it here.
              </p>
            )}
          </section>

          {/* Budget */}
          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Budget
            </h4>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Budget (Optional)</InputGroupText>
              </InputGroupAddon>
              <CurrencyInput
                value={budget}
                onValueChange={(v) => setBudget(v === "" ? 0 : v)}
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Notes</InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </InputGroup>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabeledDropdown({
  label,
  value,
  items,
  onSelect,
}: {
  label: string;
  value: string;
  items: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <InputGroup>
            <InputGroupInput
              className="cursor-pointer"
              value={value}
              readOnly
            />
          </InputGroup>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-64 overflow-y-auto">
          {items.map((item) => (
            <DropdownMenuItem key={item.key} onClick={() => onSelect(item.key)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
