"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroupField } from "@/components/ui/input-group";
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
import { Plus, UserCog } from "lucide-react";

import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import type {
  FieldCheckinStatus,
  FieldCheckinWithGroup,
  GuideBriefingWithGroup,
  GuideHandoverWithNames,
  GuideProfileRow,
} from "@/lib/types/guide-field-team";
import type { Tone } from "@/lib/ui/tone";

import {
  acknowledgeBriefingAction,
  acknowledgeHandoverAction,
  createBriefingAction,
  createCheckinAction,
  createHandoverAction,
  upsertGuideProfileAction,
} from "../../actions";

const CHECKIN_STATUS_LABELS: Record<FieldCheckinStatus, string> = {
  ALL_CLEAR: "All clear",
  DELAY: "Delay",
  ISSUE: "Issue",
  EMERGENCY: "Emergency",
};

const CHECKIN_STATUS_TONE: Record<FieldCheckinStatus, Tone> = {
  ALL_CLEAR: "success",
  DELAY: "warning",
  ISSUE: "warning",
  EMERGENCY: "danger",
};

type TabKey = "profile" | "briefings" | "handovers" | "checkins";

interface GuideFieldTeamDetailViewProps {
  staffId: string;
  fullName: string;
  guideProfile: GuideProfileRow | null;
  briefings: GuideBriefingWithGroup[];
  handovers: GuideHandoverWithNames[];
  checkins: FieldCheckinWithGroup[];
  assignedGroups: { id: string; name: string }[];
  isOwnRecord: boolean;
  canManage: boolean;
}

export default function GuideFieldTeamDetailView({
  staffId,
  fullName,
  guideProfile,
  briefings,
  handovers,
  checkins,
  assignedGroups,
  isOwnRecord,
  canManage,
}: GuideFieldTeamDetailViewProps) {
  const [tab, setTab] = useState<TabKey>("profile");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);

  const unacknowledgedBriefings = briefings.filter((b) => !b.acknowledged_at).length;
  const pendingHandovers = handovers.filter((h) => h.status === "PENDING" && h.to_staff_id === staffId).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fullName}
        breadcrumb={[
          { title: "Operations", link: "/operations" },
          { title: "Guides & Field Team", link: "/guides-field-team" },
          { title: fullName, link: `/guides-field-team/${staffId}` },
        ]}
        subTitle="Profile, briefings, handovers and field check-ins for this guide."
        action={
          isOwnRecord && tab === "checkins" ? (
            <Button onClick={() => setCheckinOpen(true)} disabled={assignedGroups.length === 0}>
              <Plus /> Check in
            </Button>
          ) : canManage && tab === "briefings" ? (
            <Button onClick={() => setBriefingOpen(true)} disabled={assignedGroups.length === 0}>
              <Plus /> New briefing
            </Button>
          ) : canManage && tab === "handovers" ? (
            <Button onClick={() => setHandoverOpen(true)} disabled={assignedGroups.length === 0}>
              <Plus /> New handover
            </Button>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="briefings">
            Briefings{unacknowledgedBriefings > 0 ? ` (${unacknowledgedBriefings})` : ""}
          </TabsTrigger>
          <TabsTrigger value="handovers">
            Handovers{pendingHandovers > 0 ? ` (${pendingHandovers})` : ""}
          </TabsTrigger>
          <TabsTrigger value="checkins">Check-ins</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "profile" && <ProfileTab staffId={staffId} guideProfile={guideProfile} canManage={canManage} />}

      {tab === "briefings" && (
        <div className="flex flex-col gap-3">
          {briefings.length === 0 ? (
            <EmptyState icon={<UserCog className="size-8" />} title="No briefings yet" />
          ) : (
            briefings.map((b) => (
              <Card key={b.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{b.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.groupName} · {formatDateTime(b.created_at)} · by {b.created_by_name}
                    </p>
                  </div>
                  {b.acknowledged_at ? (
                    <ToneBadge tone="success" label="Acknowledged" />
                  ) : isOwnRecord ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const result = await acknowledgeBriefingAction(b.id, staffId);
                        if (!result.ok) return toast.add({ title: result.error ?? "Could not acknowledge" });
                      }}
                    >
                      Acknowledge
                    </Button>
                  ) : (
                    <ToneBadge tone="warning" label="Unacknowledged" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{b.content}</p>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "handovers" && (
        <div className="flex flex-col gap-3">
          {handovers.length === 0 ? (
            <EmptyState title="No handovers yet" />
          ) : (
            handovers.map((h) => (
              <Card key={h.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {h.fromName ?? "Unassigned"} → {h.toName}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {h.groupName} · {formatDateTime(h.created_at)} · by {h.created_by_name}
                    </p>
                  </div>
                  {h.status === "ACKNOWLEDGED" ? (
                    <ToneBadge tone="success" label="Acknowledged" />
                  ) : isOwnRecord && h.to_staff_id === staffId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const result = await acknowledgeHandoverAction(h.id, staffId);
                        if (!result.ok) return toast.add({ title: result.error ?? "Could not accept" });
                      }}
                    >
                      Accept
                    </Button>
                  ) : (
                    <ToneBadge tone="warning" label="Pending" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{h.handover_notes}</p>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "checkins" && (
        <div className="flex flex-col gap-3">
          {checkins.length === 0 ? (
            <EmptyState title="No check-ins yet" description={isOwnRecord ? "Check in from your assigned group." : undefined} />
          ) : (
            checkins.map((c) => (
              <Card key={c.id} className="p-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ToneBadge tone={CHECKIN_STATUS_TONE[c.status]} label={CHECKIN_STATUS_LABELS[c.status]} />
                    <span className="text-[11px] text-muted-foreground">{c.groupName}</span>
                  </div>
                  {c.note && <p className="text-xs text-foreground mt-1">{c.note}</p>}
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDateTime(c.created_at)}</span>
              </Card>
            ))
          )}
        </div>
      )}

      {isOwnRecord && (
        <CheckinDialog open={checkinOpen} onClose={() => setCheckinOpen(false)} staffId={staffId} groups={assignedGroups} />
      )}
      {canManage && (
        <>
          <BriefingDialog open={briefingOpen} onClose={() => setBriefingOpen(false)} staffId={staffId} groups={assignedGroups} />
          <HandoverDialog
            open={handoverOpen}
            onClose={() => setHandoverOpen(false)}
            toStaffId={staffId}
            groups={assignedGroups}
          />
        </>
      )}
    </div>
  );
}

function ProfileTab({
  staffId,
  guideProfile,
  canManage,
}: {
  staffId: string;
  guideProfile: GuideProfileRow | null;
  canManage: boolean;
}) {
  const [languages, setLanguages] = useState(guideProfile?.languages.join(", ") ?? "");
  const [certifications, setCertifications] = useState(guideProfile?.certifications ?? "");
  const [yearsExperience, setYearsExperience] = useState(guideProfile?.years_experience?.toString() ?? "");
  const [emergencyName, setEmergencyName] = useState(guideProfile?.emergency_contact_name ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(guideProfile?.emergency_contact_phone ?? "");
  const [notes, setNotes] = useState(guideProfile?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await upsertGuideProfileAction({
      staffId,
      languages: languages.split(",").map((l) => l.trim()).filter(Boolean),
      certifications: certifications || null,
      yearsExperience: yearsExperience ? Number(yearsExperience) : null,
      emergencyContactName: emergencyName || null,
      emergencyContactPhone: emergencyPhone || null,
      notes: notes || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not save profile" });
      return;
    }
    toast.add({ title: "Guide profile saved" });
  };

  return (
    <Card className="p-4 flex flex-col gap-4 max-w-xl">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Languages (comma-separated)</label>
        <Input value={languages} onChange={(e) => setLanguages(e.target.value)} disabled={!canManage} placeholder="Sinhala, English, Arabic" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Certifications</label>
        <Textarea value={certifications} onChange={(e) => setCertifications(e.target.value)} disabled={!canManage} rows={2} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Years of experience</label>
        <Input type="number" value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} disabled={!canManage} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Emergency contact name</label>
          <Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} disabled={!canManage} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Emergency contact phone</label>
          <Input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} disabled={!canManage} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canManage} rows={3} />
      </div>
      {canManage && (
        <div>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
        </div>
      )}
    </Card>
  );
}

function BriefingDialog({
  open,
  onClose,
  staffId,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  staffId: string;
  groups: { id: string; name: string }[];
}) {
  const [departureGroupId, setDepartureGroupId] = useState(groups[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!departureGroupId) {
      setError("Choose a departure group.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createBriefingAction({ departureGroupId, staffId, title, content });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create briefing.");
      return;
    }
    toast.add({ title: "Briefing created" });
    setTitle("");
    setContent("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>New briefing</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Departure group</label>
            <Select value={departureGroupId} onValueChange={(v) => setDepartureGroupId(v ?? "")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <InputGroupField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pre-departure briefing" />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Content</label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !title.trim() || !content.trim()}>
            {submitting ? "Creating…" : "Create briefing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandoverDialog({
  open,
  onClose,
  toStaffId,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  toStaffId: string;
  groups: { id: string; name: string }[];
}) {
  const [departureGroupId, setDepartureGroupId] = useState(groups[0]?.id ?? "");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!departureGroupId) {
      setError("Choose a departure group.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createHandoverAction({
      departureGroupId,
      fromStaffId: null,
      toStaffId,
      handoverNotes,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create handover.");
      return;
    }
    toast.add({ title: "Handover created" });
    setHandoverNotes("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>New handover</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Departure group</label>
            <Select value={departureGroupId} onValueChange={(v) => setDepartureGroupId(v ?? "")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Handover notes</label>
            <Textarea value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} rows={5} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !handoverNotes.trim()}>
            {submitting ? "Creating…" : "Create handover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckinDialog({
  open,
  onClose,
  staffId,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  staffId: string;
  groups: { id: string; name: string }[];
}) {
  const [departureGroupId, setDepartureGroupId] = useState(groups[0]?.id ?? "");
  const [status, setStatus] = useState<FieldCheckinStatus>("ALL_CLEAR");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!departureGroupId) {
      setError("Choose a departure group.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createCheckinAction({ departureGroupId, staffId, status, note: note || null });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record check-in.");
      return;
    }
    toast.add({ title: "Checked in" });
    setNote("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>Check in</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Departure group</label>
            <Select value={departureGroupId} onValueChange={(v) => setDepartureGroupId(v ?? "")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={status} onValueChange={(v) => setStatus(v as FieldCheckinStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CHECKIN_STATUS_LABELS) as FieldCheckinStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{CHECKIN_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Arrived Makkah, all pilgrims accounted for" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Checking in…" : "Check in"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
