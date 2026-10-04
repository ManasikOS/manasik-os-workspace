"use client";

import { useState } from "react";

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
import { toast } from "@/components/ui/toast";

import type {
  AgentBookingSubmissionRow,
  CommissionAccrualRow,
  PortalAllocation,
} from "@/lib/types/agent-portal";

import {
  signOutAgentPortalAction,
  submitAgentProspectAction,
} from "../actions";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  REVIEWED: "Reviewed",
  CONVERTED: "Converted",
  REJECTED: "Rejected",
};

const ACCRUAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function AgentPortalDashboardView({
  name,
  agencyName,
  allocations,
  submissions,
  accruals,
}: {
  name: string;
  agencyName: string | null;
  allocations: PortalAllocation[];
  submissions: AgentBookingSubmissionRow[];
  accruals: CommissionAccrualRow[];
}) {
  const [submitOpen, setSubmitOpen] = useState(false);

  const pendingCommission = accruals
    .filter((a) => a.status === "PENDING" || a.status === "APPROVED")
    .reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">
            Welcome, {name}
          </h1>
          {agencyName && (
            <p className="text-xs text-muted-foreground">{agencyName}</p>
          )}
        </div>
        <form action={signOutAgentPortalAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Submissions</p>
          <p className="text-xl font-medium text-foreground">
            {submissions.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pending commission</p>
          <p className="text-xl font-medium text-foreground">
            {formatCurrency(pendingCommission)}
          </p>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-foreground">
            Your allocated packages
          </p>
          <Button
            size="sm"
            onClick={() => setSubmitOpen(true)}
            disabled={allocations.length === 0}
          >
            Submit a prospect
          </Button>
        </div>
        {allocations.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t been allocated any packages yet. Contact your
              travel agency.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {allocations.map((a) => (
              <Card
                key={a.id}
                className="p-3 flex items-center justify-between"
              >
                <p className="text-sm text-foreground">{a.packageTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {a.allocated_seats} seats allocated
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-2">
          Your submissions
        </p>
        {submissions.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t submitted any prospects yet.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {submissions.map((s) => (
              <Card
                key={s.id}
                className="p-3 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm text-foreground">{s.lead_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(s.created_at)}
                  </p>
                </div>
                <Badge
                  variant={s.status === "CONVERTED" ? "default" : "secondary"}
                >
                  {SUBMISSION_STATUS_LABELS[s.status] ?? s.status}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-2">
          Your commissions
        </p>
        {accruals.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              No commissions have been granted yet.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {accruals.map((a) => (
              <Card
                key={a.id}
                className="p-3 flex items-center justify-between gap-3"
              >
                <p className="text-sm text-foreground">
                  {formatCurrency(a.amount)}
                </p>
                <Badge variant={a.status === "PAID" ? "default" : "secondary"}>
                  {ACCRUAL_STATUS_LABELS[a.status] ?? a.status}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>

      {submitOpen && (
        <SubmitProspectDialog
          allocations={allocations}
          onClose={() => setSubmitOpen(false)}
        />
      )}
    </div>
  );
}

function SubmitProspectDialog({
  allocations,
  onClose,
}: {
  allocations: PortalAllocation[];
  onClose: () => void;
}) {
  const [leadName, setLeadName] = useState("");
  const [leadContact, setLeadContact] = useState("");
  const [packageId, setPackageId] = useState<string>(
    allocations[0]?.package_id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await submitAgentProspectAction({
      packageId: packageId || null,
      leadName,
      leadContact: leadContact || null,
      notes: notes || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not submit.");
      return;
    }
    toast.add({ title: "Submitted" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Submit a prospect</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Their name
            </label>
            <Input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Contact (optional)
            </label>
            <Input
              value={leadContact}
              onChange={(e) => setLeadContact(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Package
            </label>
            <Select
              value={packageId}
              onValueChange={(v) => setPackageId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allocations.map((a) => (
                  <SelectItem key={a.package_id} value={a.package_id}>
                    {a.packageTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
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
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !leadName.trim()}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
