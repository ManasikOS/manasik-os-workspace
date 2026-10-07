"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Speaker } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import type { GroupPickerOption } from "@/lib/data/bookings-repository";
import type {
  AnnouncementChannel,
  AnnouncementStatus,
  AnnouncementTargetType,
  AnnouncementWithReach,
} from "@/lib/types/announcements";
import type { AudienceWithSize } from "@/lib/types/audiences";
import type { WhatsAppTemplateRow } from "@/lib/types/whatsapp";
import type { Tone } from "@/lib/ui/tone";
import { countBodyVariables } from "@/lib/whatsapp/template-params";

import {
  cancelAnnouncementAction,
  createAnnouncementAction,
  sendAnnouncementAction,
} from "../actions";

const STATUS_LABELS: Record<AnnouncementStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENT: "Sent",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<AnnouncementStatus, Tone> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  SENT: "success",
  CANCELLED: "danger",
};

const CHANNEL_LABELS: Record<AnnouncementChannel, string> = {
  PORTAL: "Portal",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  IN_APP: "In-app",
};

interface AnnouncementsViewProps {
  announcements: AnnouncementWithReach[];
  groups: GroupPickerOption[];
  audiences: AudienceWithSize[];
  whatsappTemplates: WhatsAppTemplateRow[];
  canManage: boolean;
}

export default function AnnouncementsView({
  announcements,
  groups,
  audiences,
  whatsappTemplates,
  canManage,
}: AnnouncementsViewProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const sentCount = announcements.filter((a) => a.status === "SENT").length;
  const totalReach = announcements.reduce(
    (sum, a) => sum + a.reach.contactableCount,
    0,
  );
  const totalRead = announcements.reduce(
    (sum, a) => sum + a.reach.readCount,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Announcements"
        breadcrumb={[
          { title: "Relationships", link: "#" },
          { title: "Announcements", link: "/relationships/announcements" },
        ]}
        subTitle="Broadcast to a departure group or a saved audience, with consent applied automatically at send time."
        action={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New announcement
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Announcements" value={String(announcements.length)} />
        <KpiCard title="Sent" value={String(sentCount)} />
        <KpiCard title="Total reach" value={String(totalReach)} />
        <KpiCard title="Read" value={String(totalRead)} />
      </div>

      <Card className="p-0 overflow-x-auto no-scrollbar">
        {announcements.length === 0 ? (
          <EmptyState
            icon={<Speaker className="size-8" />}
            title="No announcements yet"
            description={
              canManage ? "Create the first announcement." : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Title",
                  "Channel",
                  "Target",
                  "Reach",
                  "Delivered",
                  "Failed",
                  "Read",
                  "Status",
                  "Sent",
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
              {announcements.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/40">
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">
                      {a.body}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {CHANNEL_LABELS[a.channel]}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    <Badge variant="secondary">
                      {a.target_type === "DEPARTURE_GROUP"
                        ? "Group"
                        : "Audience"}
                    </Badge>{" "}
                    {a.reach.targetName}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {a.status === "SENT" ? a.reach.contactableCount : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {a.status === "SENT" ? a.reach.deliveredCount : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {a.status === "SENT" && a.reach.failedCount > 0 ? (
                      <span className="text-destructive">
                        {a.reach.failedCount}
                      </span>
                    ) : a.status === "SENT" ? (
                      "0"
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {a.status === "SENT" ? a.reach.readCount : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge
                      tone={STATUS_TONE[a.status]}
                      label={STATUS_LABELS[a.status]}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {a.sent_at ? formatDate(a.sent_at) : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    {canManage && a.status === "DRAFT" && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          onClick={async () => {
                            const result = await sendAnnouncementAction(a.id);
                            if (!result.ok)
                              return toast.add({
                                title: result.error ?? "Could not send",
                              });
                            if (
                              a.channel === "WHATSAPP" &&
                              result.sent !== undefined
                            ) {
                              toast.add({
                                title:
                                  result.failed && result.failed > 0
                                    ? `Sent to ${result.sent}, ${result.failed} failed`
                                    : `Sent to ${result.sent}`,
                              });
                            } else {
                              toast.add({ title: "Announcement sent" });
                            }
                          }}
                        >
                          Send now
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const result = await cancelAnnouncementAction(a.id);
                            if (!result.ok)
                              return toast.add({
                                title: result.error ?? "Could not cancel",
                              });
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CreateAnnouncementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        groups={groups}
        audiences={audiences}
        whatsappTemplates={whatsappTemplates}
      />
    </div>
  );
}

function CreateAnnouncementDialog({
  open,
  onClose,
  groups,
  audiences,
  whatsappTemplates,
}: {
  open: boolean;
  onClose: () => void;
  groups: GroupPickerOption[];
  audiences: AudienceWithSize[];
  whatsappTemplates: WhatsAppTemplateRow[];
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<AnnouncementChannel>("PORTAL");
  const [targetType, setTargetType] =
    useState<AnnouncementTargetType>("AUDIENCE");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [audienceId, setAudienceId] = useState(audiences[0]?.id ?? "");
  const [whatsappTemplateId, setWhatsappTemplateId] = useState(
    whatsappTemplates[0]?.id ?? "",
  );
  const [whatsappTemplateParam, setWhatsappTemplateParam] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate =
    whatsappTemplates.find((t) => t.id === whatsappTemplateId) ?? null;
  const templateVariableCount = selectedTemplate
    ? countBodyVariables(selectedTemplate.components)
    : 0;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createAnnouncementAction({
      title,
      body:
        channel === "WHATSAPP" ? body || "(sent via WhatsApp template)" : body,
      channel,
      targetType,
      departureGroupId:
        targetType === "DEPARTURE_GROUP" ? groupId || null : null,
      audienceId: targetType === "AUDIENCE" ? audienceId || null : null,
      whatsappTemplateId:
        channel === "WHATSAPP" ? whatsappTemplateId || null : null,
      whatsappTemplateParam:
        channel === "WHATSAPP" && templateVariableCount > 0
          ? whatsappTemplateParam || null
          : null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the announcement.");
      return;
    }
    toast.add({ title: "Announcement created as draft" });
    setTitle("");
    setBody("");
    setWhatsappTemplateParam("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle>New announcement</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Title
            </label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {channel === "WHATSAPP"
                ? "Internal note (not sent — see WhatsApp template below)"
                : "Body"}
            </label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === "WHATSAPP" ? 2 : 4}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Channel
              </label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as AnnouncementChannel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABELS) as AnnouncementChannel[]).map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Target
              </label>
              <Select
                value={targetType}
                onValueChange={(v) =>
                  setTargetType(v as AnnouncementTargetType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUDIENCE">Saved audience</SelectItem>
                  <SelectItem value="DEPARTURE_GROUP">
                    Departure group
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {channel === "WHATSAPP" && (
            <div className="flex flex-col gap-3 rounded-md border border-border/40 p-3">
              <p className="text-[11px] text-muted-foreground">
                Broadcast recipients are outside the 24-hour service window, so
                WhatsApp only allows an approved template message — never free
                text.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Approved template
                </label>
                <Select
                  value={whatsappTemplateId}
                  onValueChange={(v) => setWhatsappTemplateId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        whatsappTemplates.length === 0
                          ? "No approved templates"
                          : undefined
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {whatsappTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.language})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {whatsappTemplates.length === 0 && (
                  <p className="text-[11px] text-destructive">
                    No approved WhatsApp templates yet — create and get one
                    approved in Settings → WhatsApp Templates first.
                  </p>
                )}
              </div>
              {templateVariableCount > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Template variable ({"{{1}}"})
                  </label>
                  <Input
                    value={whatsappTemplateParam}
                    onChange={(e) => setWhatsappTemplateParam(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          {targetType === "AUDIENCE" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Audience
              </label>
              <Select
                value={audienceId}
                onValueChange={(v) => setAudienceId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      audiences.length === 0 ? "No audiences yet" : undefined
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.liveCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Departure group
              </label>
              <Select
                value={groupId}
                onValueChange={(v) => setGroupId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      groups.length === 0 ? "No open groups" : undefined
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.groupName} ({g.groupCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !title.trim() ||
              (channel !== "WHATSAPP" && !body.trim()) ||
              (channel === "WHATSAPP" && !whatsappTemplateId)
            }
          >
            {submitting ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
