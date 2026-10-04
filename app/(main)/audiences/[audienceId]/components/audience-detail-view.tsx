"use client";

import { useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { Plus, Trash2 } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import {
  LEAD_STAGE_LABELS,
  type LeadSource,
  type LeadStage,
} from "@/lib/types/leads";
import type { PilgrimJourneyStatus } from "@/lib/types/pilgrims";
import type { ConsentStatus } from "@/lib/types/consent";
import type {
  AudienceMemberPreview,
  AudienceWithSize,
  LeadAudienceFilters,
  PilgrimAudienceFilters,
} from "@/lib/types/audiences";
import type { Tone } from "@/lib/ui/tone";

import {
  addStaticMemberAction,
  deleteAudienceAction,
  removeStaticMemberAction,
  updateAudienceFiltersAction,
} from "../../actions";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";

const LEAD_SOURCES: LeadSource[] = [
  "WHATSAPP",
  "PHONE_CALL",
  "WALK_IN",
  "FACEBOOK",
  "INSTAGRAM",
  "WEBSITE",
  "GOOGLE",
  "REFERRAL",
  "REPEAT_CUSTOMER",
  "COMMUNITY_EVENT",
  "OTHER",
];

const LEAD_STAGES = Object.keys(LEAD_STAGE_LABELS) as LeadStage[];

const JOURNEY_STATUSES: PilgrimJourneyStatus[] = [
  "PENDING_DETAILS",
  "ONBOARDING",
  "DOCUMENTS_PENDING",
  "VISA_PROCESSING",
  "PAYMENT_PENDING",
  "PREPARING",
  "READY_TO_TRAVEL",
  "TRAVELLED",
  "COMPLETED",
  "CANCELLED",
];

const CONSENT_STATUSES: ConsentStatus[] = ["UNKNOWN", "OPTED_IN", "OPTED_OUT"];
const CONSENT_LABELS: Record<ConsentStatus, string> = {
  UNKNOWN: "Unknown",
  OPTED_IN: "Opted in",
  OPTED_OUT: "Opted out",
};
const CONSENT_TONE: Record<ConsentStatus, Tone> = {
  UNKNOWN: "neutral",
  OPTED_IN: "success",
  OPTED_OUT: "danger",
};

interface AudienceDetailViewProps {
  audience: AudienceWithSize;
  members: AudienceMemberPreview[];
  canManage: boolean;
}

export default function AudienceDetailView({
  audience,
  members,
  canManage,
}: AudienceDetailViewProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const notContactable = members.filter(
    (m) => m.doNotContact || m.consentStatus === "OPTED_OUT",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={audience.name}
        breadcrumb={[
          { title: "Grow", link: "#" },
          { title: "Audiences", link: "/audiences" },
          { title: audience.name, link: `/audiences/${audience.id}` },
        ]}
        subTitle={audience.description ?? undefined}
        action={
          canManage && (
            <Button variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {audience.subject_type === "LEAD" ? "Leads" : "Pilgrims"}
        </Badge>
        <Badge variant="secondary">
          {audience.audience_type === "DYNAMIC" ? "Dynamic" : "Static"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard title="Live size" value={String(audience.liveCount)} />
        <KpiCard title="Not contactable" value={String(notContactable)} />
        <KpiCard
          title="Last computed"
          value={
            audience.audience_type === "DYNAMIC"
              ? "Live"
              : formatDate(audience.updated_at)
          }
        />
      </div>

      {audience.audience_type === "DYNAMIC" ? (
        audience.subject_type === "LEAD" ? (
          <LeadFilterEditor
            audienceId={audience.id}
            filters={(audience.filters as LeadAudienceFilters) ?? {}}
            canManage={canManage}
          />
        ) : (
          <PilgrimFilterEditor
            audienceId={audience.id}
            filters={(audience.filters as PilgrimAudienceFilters) ?? {}}
            canManage={canManage}
          />
        )
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-foreground">
              Static membership
            </p>
            {canManage && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add member
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Members are added and removed by ID below. Consent is still checked
            live at send time.
          </p>
        </Card>
      )}

      <Card className="p-0 overflow-x-auto no-scrollbar">
        {members.length === 0 ? (
          <EmptyState
            title="No members yet"
            description="Adjust the filters above, or add members to this list."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Name",
                  "Contact",
                  audience.subject_type === "LEAD" ? "Stage" : "Journey status",
                  "Consent",
                  "",
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
              {members.map((m) => (
                <TableRow key={m.subjectId} className="hover:bg-muted/40">
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {m.name}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {m.contact ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {m.detail}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <ToneBadge
                        tone={CONSENT_TONE[m.consentStatus]}
                        label={CONSENT_LABELS[m.consentStatus]}
                      />
                      {m.doNotContact && (
                        <ToneBadge tone="danger" label="DNC" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    {audience.audience_type === "STATIC" && canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const result = await removeStaticMemberAction(
                            audience.id,
                            m.subjectId,
                          );
                          if (!result.ok) {
                            toast.add({
                              title: result.error ?? "Could not remove member",
                            });
                            return;
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {audience.audience_type === "STATIC" && (
        <AddMemberDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          audienceId={audience.id}
          subjectType={audience.subject_type}
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm!">
          <DialogHeader>
            <DialogTitle>Delete this audience?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the saved segment. It does not affect the leads or
            pilgrims themselves, or any campaign that already ran against it.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const result = await deleteAudienceAction(audience.id);
                if (!result.ok) {
                  toast.add({
                    title: result.error ?? "Could not delete audience",
                  });
                  return;
                }
                router.push("/audiences");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConsentFilterRow({
  value,
  onChange,
}: {
  value: ConsentStatus[] | undefined;
  onChange: (next: ConsentStatus[]) => void;
}) {
  const selected = value ?? [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {CONSENT_STATUSES.map((status) => (
        <Badge
          key={status}
          variant={selected.includes(status) ? "default" : "secondary"}
          className="cursor-pointer"
          onClick={() =>
            onChange(
              selected.includes(status)
                ? selected.filter((s) => s !== status)
                : [...selected, status],
            )
          }
        >
          {CONSENT_LABELS[status]}
        </Badge>
      ))}
    </div>
  );
}

function LeadFilterEditor({
  audienceId,
  filters,
  canManage,
}: {
  audienceId: string;
  filters: LeadAudienceFilters;
  canManage: boolean;
}) {
  const [stages, setStages] = useState<LeadStage[]>(filters.stages ?? []);
  const [sources, setSources] = useState<LeadSource[]>(filters.sources ?? []);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus[]>(
    filters.consentStatus ?? [],
  );
  const [doNotContact, setDoNotContact] = useState<boolean | undefined>(
    filters.doNotContact,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await updateAudienceFiltersAction(audienceId, {
      stages: stages.length ? stages : undefined,
      sources: sources.length ? sources : undefined,
      consentStatus: consentStatus.length ? consentStatus : undefined,
      doNotContact,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not save filters" });
      return;
    }
    toast.add({ title: "Filters saved" });
  };

  return (
    <Card className="p-4 flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground">Filters</p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Pipeline stage
        </label>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_STAGES.map((stage) => (
            <Badge
              key={stage}
              variant={stages.includes(stage) ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() =>
                setStages((prev) =>
                  prev.includes(stage)
                    ? prev.filter((s) => s !== stage)
                    : [...prev, stage],
                )
              }
            >
              {LEAD_STAGE_LABELS[stage]}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Source
        </label>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_SOURCES.map((source) => (
            <Badge
              key={source}
              variant={sources.includes(source) ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() =>
                setSources((prev) =>
                  prev.includes(source)
                    ? prev.filter((s) => s !== source)
                    : [...prev, source],
                )
              }
            >
              {source.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Consent status
        </label>
        <ConsentFilterRow value={consentStatus} onChange={setConsentStatus} />
      </div>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox
          checked={doNotContact === true}
          onCheckedChange={(v) => setDoNotContact(v ? true : undefined)}
        />
        Do-not-contact only
      </label>
      {canManage && (
        <div>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save filters"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function PilgrimFilterEditor({
  audienceId,
  filters,
  canManage,
}: {
  audienceId: string;
  filters: PilgrimAudienceFilters;
  canManage: boolean;
}) {
  const [journeyStatuses, setJourneyStatuses] = useState<
    PilgrimJourneyStatus[]
  >(filters.journeyStatuses ?? []);
  const [nationality, setNationality] = useState(filters.nationality ?? "");
  const [consentStatus, setConsentStatus] = useState<ConsentStatus[]>(
    filters.consentStatus ?? [],
  );
  const [doNotContact, setDoNotContact] = useState<boolean | undefined>(
    filters.doNotContact,
  );
  const [travelledMonthsAgoMin, setTravelledMonthsAgoMin] = useState(
    filters.travelledMonthsAgoMin != null
      ? String(filters.travelledMonthsAgoMin)
      : "",
  );
  const [travelledMonthsAgoMax, setTravelledMonthsAgoMax] = useState(
    filters.travelledMonthsAgoMax != null
      ? String(filters.travelledMonthsAgoMax)
      : "",
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await updateAudienceFiltersAction(audienceId, {
      journeyStatuses: journeyStatuses.length ? journeyStatuses : undefined,
      nationality: nationality.trim() || null,
      consentStatus: consentStatus.length ? consentStatus : undefined,
      doNotContact,
      travelledMonthsAgoMin: travelledMonthsAgoMin.trim()
        ? Number(travelledMonthsAgoMin)
        : null,
      travelledMonthsAgoMax: travelledMonthsAgoMax.trim()
        ? Number(travelledMonthsAgoMax)
        : null,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not save filters" });
      return;
    }
    toast.add({ title: "Filters saved" });
  };

  return (
    <Card className="p-4 flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground">Filters</p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Journey status
        </label>
        <div className="flex flex-wrap gap-1.5">
          {JOURNEY_STATUSES.map((status) => (
            <Badge
              key={status}
              variant={
                journeyStatuses.includes(status) ? "default" : "secondary"
              }
              className="cursor-pointer"
              onClick={() =>
                setJourneyStatuses((prev) =>
                  prev.includes(status)
                    ? prev.filter((s) => s !== status)
                    : [...prev, status],
                )
              }
            >
              {status.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Nationality
        </label>
        <Input
          value={nationality}
          onChange={(e) => setNationality(e.target.value)}
          placeholder="e.g. Sri Lankan"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Months since last travel
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={travelledMonthsAgoMin}
            onChange={(e) => setTravelledMonthsAgoMin(e.target.value)}
            placeholder="Min"
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="number"
            min={0}
            value={travelledMonthsAgoMax}
            onChange={(e) => setTravelledMonthsAgoMax(e.target.value)}
            placeholder="Max"
            className="w-24"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Based on the pilgrim&apos;s most recent completed departure. For
          reactivation, try 6–12 months.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Consent status
        </label>
        <ConsentFilterRow value={consentStatus} onChange={setConsentStatus} />
      </div>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox
          checked={doNotContact === true}
          onCheckedChange={(v) => setDoNotContact(v ? true : undefined)}
        />
        Do-not-contact only
      </label>
      {canManage && (
        <div>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save filters"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function AddMemberDialog({
  open,
  onClose,
  audienceId,
  subjectType,
}: {
  open: boolean;
  onClose: () => void;
  audienceId: string;
  subjectType: "LEAD" | "PILGRIM";
}) {
  const [ids, setIds] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const list = ids
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setError("Enter at least one ID.");
      return;
    }
    setSubmitting(true);
    setError(null);
    for (const subjectId of list) {
      const result = await addStaticMemberAction({
        audienceId,
        subjectType,
        subjectId,
      });
      if (!result.ok) {
        setError(result.error ?? `Could not add ${subjectId}`);
        setSubmitting(false);
        return;
      }
    }
    setSubmitting(false);
    toast.add({
      title: `Added ${list.length} member${list.length === 1 ? "" : "s"}`,
    });
    setIds("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>
            Add {subjectType === "LEAD" ? "leads" : "pilgrims"} to this audience
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-xs text-muted-foreground">
            Paste one {subjectType.toLowerCase()} ID per line — from the{" "}
            {subjectType === "LEAD" ? "lead" : "pilgrim"} record&apos;s URL.
          </p>
          <InputGroup>
            <InputGroupTextarea
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              rows={5}
              placeholder="uuid&#10;uuid"
            />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
