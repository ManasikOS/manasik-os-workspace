"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  EmptyState,
  PermissionDenied,
  ToneBadge,
} from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useState } from "react";

import { ROLE_LABELS, type StaffRole } from "@/lib/access/departure-groups-access";
import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type {
  PilgrimSupportCategory,
  PilgrimSupportPriority,
  PilgrimSupportRequestRow,
  SupportCaseAttachmentRow,
  SupportCaseEventRow,
} from "@/lib/types/pilgrims";
import { TONE_TEXT, type Tone } from "@/lib/ui/tone";
import type { PilgrimProfile } from "../../../types";
import {
  addSupportCaseCommentAction,
  createSupportRequestAction,
  escalateSupportRequestAction,
  linkSupportCaseSupplierAction,
  logMedicalViewAction,
  recordSupportCaseAttachmentAction,
  removeSupportCaseAttachmentAction,
  updateMedicalRecordAction,
  updateSupportRequestStatusAction,
} from "../../../actions";
import {
  createSupportCaseAttachmentDownloadUrl,
  createSupportCaseAttachmentUploadUrl,
} from "../../../attachment-storage";
import {
  listActiveSuppliersAction,
  type ActiveSupplierOption,
} from "@/app/(main)/departure-groups/actions";
import SectionHeading from "@/components/section-heading";
import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const PRIORITY_TONE: Record<PilgrimSupportPriority, Tone> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const CATEGORY_LABELS: Record<PilgrimSupportCategory, string> = {
  MOBILITY: "Mobility",
  MEDICAL: "Medical",
  DIETARY: "Dietary",
  FLIGHT: "Flight",
  ROOMING: "Rooming",
  DOCUMENT: "Document",
  PAYMENT: "Payment",
  COMPLAINT: "Complaint",
  OTHER: "Other",
};

const PRIORITY_CHOICES: PilgrimSupportPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const CATEGORY_CHOICES: PilgrimSupportCategory[] = [
  "MOBILITY",
  "MEDICAL",
  "DIETARY",
  "FLIGHT",
  "ROOMING",
  "DOCUMENT",
  "PAYMENT",
  "COMPLAINT",
  "OTHER",
];
const ESCALATION_ROLES: StaffRole[] = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"];

export default function SupportTab({
  profile,
  can,
}: {
  profile: PilgrimProfile;
  can: PilgrimCapabilities;
}) {
  const router = useRouter();
  const [medical, setMedical] = useState({
    mobilitySupport: profile.medical?.mobility_support ?? false,
    wheelchairRequired: profile.medical?.wheelchair_required ?? false,
    dietaryRequirement: profile.medical?.dietary_requirement ?? "",
    allergyInformation: profile.medical?.allergy_information ?? "",
    medicationNote: profile.medical?.medication_note ?? "",
    accessibilityNote: profile.medical?.accessibility_note ?? "",
    specialAssistance: profile.medical?.special_assistance ?? "",
  });
  const [savingMedical, setSavingMedical] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState<PilgrimSupportCategory>("OTHER");
  const [priority, setPriority] = useState<PilgrimSupportPriority>("NORMAL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (can.viewMedical) void logMedicalViewAction(profile.person.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.person.id]);

  if (!can.viewMedical && !can.manageSupportRequests)
    return <PermissionDenied what="Support & Medical" />;

  const saveMedical = async () => {
    setSavingMedical(true);
    const result = await updateMedicalRecordAction({
      pilgrimId: profile.person.id,
      ...medical,
    });
    setSavingMedical(false);
    if (!result.ok)
      return toast.add({ title: "Could not save", description: result.error });
    toast.add({ title: "Medical record updated" });
    router.refresh();
  };

  const createRequest = async () => {
    if (!title.trim()) return;
    const result = await createSupportRequestAction({
      pilgrimId: profile.person.id,
      departureGroupId: profile.activeJourney?.groupId ?? null,
      title,
      detail,
      category,
      priority,
      assignedRole: "OPERATIONS",
    });
    if (!result.ok)
      return toast.add({
        title: "Could not create request",
        description: result.error,
      });
    toast.add({ title: "Support request raised" });
    setRequestOpen(false);
    setTitle("");
    setDetail("");
    setCategory("OTHER");
    setPriority("NORMAL");
    router.refresh();
  };

  const changeStatus = async (requestId: string, status: PilgrimSupportRequestRow["status"]) => {
    const result = await updateSupportRequestStatusAction({
      pilgrimId: profile.person.id,
      requestId,
      status,
    });
    if (!result.ok)
      return toast.add({
        title: "Could not update",
        description: result.error,
      });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <div className="flex items-center justify-between">
          <SectionHeading title="Support Cases" />
          {can.manageSupportRequests && (
            <Button
              size="sm"
              variant="outline_without_border"
              onClick={() => setRequestOpen(true)}
            >
              Create Support Request
            </Button>
          )}
        </div>
        {profile.support.length === 0 ? (
          <EmptyState title="No support requests" />
        ) : (
          <div className="flex flex-col divide-y divide-border/40">
            {profile.support.map((request) => (
              <CaseRow
                key={request.id}
                request={request}
                events={profile.caseEvents.filter((e) => e.support_request_id === request.id)}
                attachments={profile.caseAttachments.filter((a) => a.support_request_id === request.id)}
                pilgrimId={profile.person.id}
                canManage={can.manageSupportRequests}
                expanded={expandedId === request.id}
                onToggle={() => setExpandedId((id) => (id === request.id ? null : request.id))}
                onChangeStatus={(status) => changeStatus(request.id, status)}
                onRefresh={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </Card>

      {can.viewMedical && (
        <Card className="gap-4">
          <SectionHeading title="Medical & Accessibility" />
          <div className="flex items-center gap-2">
            <Checkbox
              checked={medical.mobilitySupport}
              onCheckedChange={(v) =>
                setMedical((m) => ({ ...m, mobilitySupport: !!v }))
              }
              disabled={!can.editMedical}
            />
            <span className="text-sm">Mobility support required</span>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={medical.wheelchairRequired}
              onCheckedChange={(v) =>
                setMedical((m) => ({ ...m, wheelchairRequired: !!v }))
              }
              disabled={!can.editMedical}
            />
            <span className="text-sm">Wheelchair needed</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Dietary requirement</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={medical.dietaryRequirement}
                disabled={!can.editMedical}
                onChange={(e) =>
                  setMedical((m) => ({
                    ...m,
                    dietaryRequirement: e.target.value,
                  }))
                }
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Allergy information</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={medical.allergyInformation}
                disabled={!can.editMedical}
                onChange={(e) =>
                  setMedical((m) => ({
                    ...m,
                    allergyInformation: e.target.value,
                  }))
                }
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Medication note</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={medical.medicationNote}
                disabled={!can.editMedical}
                onChange={(e) =>
                  setMedical((m) => ({ ...m, medicationNote: e.target.value }))
                }
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Accessibility requirement</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={medical.accessibilityNote}
                disabled={!can.editMedical}
                onChange={(e) =>
                  setMedical((m) => ({
                    ...m,
                    accessibilityNote: e.target.value,
                  }))
                }
              />
            </InputGroup>
          </div>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> Special assistance notes</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={medical.specialAssistance}
              disabled={!can.editMedical}
              onChange={(e) =>
                setMedical((m) => ({ ...m, specialAssistance: e.target.value }))
              }
            />
          </InputGroup>
          {can.editMedical && (
            <div className="flex justify-end">
              <Button size="sm" onClick={saveMedical} disabled={savingMedical}>
                {savingMedical ? "Saving…" : "Save Medical Record"}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Optional. Never exposed broadly — Finance and Marketing do not see
            this section. Every view is logged.
          </p>
        </Card>
      )}

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Create support request</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Title, e.g. Wheelchair assistance at airport"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              placeholder="Detail (optional)"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select value={category} onValueChange={(v) => setCategory(v as PilgrimSupportCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_CHOICES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={(v) => setPriority(v as PilgrimSupportPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_CHOICES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createRequest} disabled={!title.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── One case row: status, SLA, escalation, supplier, comment thread ─────── */

function CaseRow({
  request,
  events,
  attachments,
  pilgrimId,
  canManage,
  expanded,
  onToggle,
  onChangeStatus,
  onRefresh,
}: {
  request: PilgrimSupportRequestRow;
  events: SupportCaseEventRow[];
  attachments: SupportCaseAttachmentRow[];
  pilgrimId: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChangeStatus: (status: PilgrimSupportRequestRow["status"]) => void;
  onRefresh: () => void;
}) {
  const [comment, setComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateRole, setEscalateRole] = useState<StaffRole>("OPERATIONS");
  const [escalateReason, setEscalateReason] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [suppliers, setSuppliers] = useState<ActiveSupplierOption[] | null>(null);
  const [linkingSupplier, setLinkingSupplier] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [now] = useState(() => Date.now());
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isClosed = request.status === "RESOLVED" || request.status === "CANCELLED";
  const isOverdue = !isClosed && request.sla_due_at !== null && Date.parse(request.sla_due_at) < now;

  const loadSuppliers = async () => {
    if (suppliers !== null) return;
    const result = await listActiveSuppliersAction();
    setSuppliers(result.ok ? result.suppliers : []);
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    setPostingComment(true);
    const result = await addSupportCaseCommentAction({
      pilgrimId,
      requestId: request.id,
      message: comment,
    });
    setPostingComment(false);
    if (!result.ok) return toast.add({ title: "Could not add comment", description: result.error });
    setComment("");
    onRefresh();
  };

  const submitEscalation = async () => {
    if (!escalateReason.trim()) return;
    setEscalating(true);
    const result = await escalateSupportRequestAction({
      pilgrimId,
      requestId: request.id,
      toRole: escalateRole,
      reason: escalateReason,
    });
    setEscalating(false);
    if (!result.ok) return toast.add({ title: "Could not escalate", description: result.error });
    toast.add({ title: `Escalated to ${ROLE_LABELS[escalateRole]}` });
    setEscalateOpen(false);
    setEscalateReason("");
    onRefresh();
  };

  const linkSupplier = async (supplierId: string | null) => {
    if (!supplierId) return;
    const supplier = suppliers?.find((s) => s.id === supplierId) ?? null;
    setLinkingSupplier(true);
    const result = await linkSupportCaseSupplierAction({
      pilgrimId,
      requestId: request.id,
      supplierId: supplierId === "NONE" ? null : supplierId,
      supplierName: supplier?.name ?? null,
    });
    setLinkingSupplier(false);
    if (!result.ok) return toast.add({ title: "Could not link supplier", description: result.error });
    onRefresh();
  };

  /** Uploads straight to the private bucket with a one-shot signed URL, then records the resulting object path. */
  const uploadAttachment = async (file: File) => {
    setUploading(true);
    try {
      const signed = await createSupportCaseAttachmentUploadUrl({
        pilgrimId,
        requestId: request.id,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!signed.ok) {
        toast.add({ title: "Upload refused", description: signed.error });
        return;
      }

      const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        toast.add({ title: "Upload failed", description: "The file could not be stored. Try again." });
        return;
      }

      const recorded = await recordSupportCaseAttachmentAction({
        pilgrimId,
        requestId: request.id,
        filePath: signed.path,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!recorded.ok) {
        toast.add({ title: "Could not record attachment", description: recorded.error });
        return;
      }
      onRefresh();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openAttachment = async (attachment: SupportCaseAttachmentRow) => {
    const result = await createSupportCaseAttachmentDownloadUrl(attachment.file_path);
    if (!result.ok) return toast.add({ title: "Could not open file", description: result.error });
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const removeAttachment = async (attachmentId: string) => {
    const result = await removeSupportCaseAttachmentAction({ pilgrimId, requestId: request.id, attachmentId });
    if (!result.ok) return toast.add({ title: "Could not remove attachment", description: result.error });
    onRefresh();
  };

  return (
    <div className="py-3">
      <div
        className="flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => {
          onToggle();
          void loadSuppliers();
        }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-foreground truncate">{request.title}</span>
          <span className="text-xs text-muted-foreground truncate">{request.detail}</span>
          <span className="text-[11px] text-muted-foreground">
            Assigned to: {request.assigned_role}
            {request.sla_due_at && (
              <>
                {" · "}
                <span className={isOverdue ? "text-destructive" : undefined}>
                  SLA due {formatDateTime(request.sla_due_at)}
                </span>
              </>
            )}
            {request.escalated_to_role && (
              <span className={TONE_TEXT.warning}> · Escalated to {request.escalated_to_role}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <ToneBadge tone={PRIORITY_TONE[request.priority]} label={request.priority} />
          <ToneBadge
            tone={request.status === "OPEN" ? "warning" : request.status === "RESOLVED" ? "success" : "neutral"}
            label={request.status.replace(/_/g, " ")}
          />
          {canManage && (
            <Select value={request.status} onValueChange={(v) => onChangeStatus(v as PilgrimSupportRequestRow["status"])}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 rounded-md bg-muted/30 p-3">
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {!isClosed && (
                <Button size="sm" variant="outline_without_border" onClick={() => setEscalateOpen(true)}>
                  Escalate
                </Button>
              )}
              <Select
                value={request.supplier_id ?? "NONE"}
                onValueChange={linkSupplier}
                disabled={linkingSupplier}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue placeholder="Link a supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No supplier linked</SelectItem>
                  {(suppliers ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">Attachments</span>
              {canManage && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadAttachment(file);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Add file"}
                  </Button>
                </>
              )}
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files attached.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      className="text-foreground underline underline-offset-2 truncate text-left"
                      onClick={() => openAttachment(attachment)}
                    >
                      {attachment.file_name}
                    </button>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove attachment"
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Case history</span>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity recorded on this case yet.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto no-scrollbar">
                {events.map((event) => (
                  <div key={event.id} className="text-xs">
                    <p className="text-foreground">{event.message}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {event.actor_name} · {formatDateTime(event.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="h-8 text-xs"
              />
              <Button size="sm" disabled={postingComment || !comment.trim()} onClick={postComment}>
                {postingComment ? "Posting…" : "Post"}
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Escalate case</DialogTitle>
            <DialogDescription>Bumps priority to at least High and reassigns the case.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select value={escalateRole} onValueChange={(v) => setEscalateRole(v as StaffRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ESCALATION_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Reason for escalating"
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitEscalation} disabled={escalating || !escalateReason.trim()}>
              {escalating ? "Escalating…" : "Escalate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
