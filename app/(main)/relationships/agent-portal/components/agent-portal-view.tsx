"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import { Handshake, Plus } from "lucide-react";

import { formatDate, formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type { PackageTemplateOption } from "@/app/(main)/departure-groups/types";
import type {
  AgentSettlementWithContext,
  AgentSubmissionStatus,
  AgentSubmissionWithAgent,
  CommissionAccrualWithContext,
  CommissionRuleRow,
  SalesAgentStatus,
  SalesAgentWithMetrics,
} from "@/lib/types/agent-portal";
import type { Tone } from "@/lib/ui/tone";

import {
  createAgentAllocationAction,
  createAgentSubmissionAction,
  createCommissionRuleAction,
  createSalesAgentAction,
  createSettlementAction,
  grantCommissionAction,
  inviteSalesAgentToPortalAction,
  updateCommissionAccrualStatusAction,
  updateSalesAgentStatusAction,
  updateSubmissionStatusAction,
} from "../actions";

const AGENT_STATUS_TONE: Record<SalesAgentStatus, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  INACTIVE: "neutral",
};

const SUBMISSION_STATUS_LABELS: Record<AgentSubmissionStatus, string> = {
  SUBMITTED: "Submitted",
  REVIEWED: "Reviewed",
  CONVERTED: "Converted",
  REJECTED: "Rejected",
};

const SUBMISSION_STATUS_TONE: Record<AgentSubmissionStatus, Tone> = {
  SUBMITTED: "neutral",
  REVIEWED: "info",
  CONVERTED: "success",
  REJECTED: "danger",
};

const ACCRUAL_STATUS_TONE: Record<string, Tone> = {
  PENDING: "warning",
  APPROVED: "info",
  PAID: "success",
  CANCELLED: "danger",
};

type TabKey = "agents" | "submissions" | "commissions";

interface AgentPortalViewProps {
  agents: SalesAgentWithMetrics[];
  submissions: AgentSubmissionWithAgent[];
  commissionRules: CommissionRuleRow[];
  accruals: CommissionAccrualWithContext[];
  settlements: AgentSettlementWithContext[];
  packages: PackageTemplateOption[];
  canManage: boolean;
  canManageCommissions: boolean;
  initialTab?: TabKey;
}

export default function AgentPortalView({
  agents,
  submissions,
  commissionRules,
  accruals,
  settlements,
  packages,
  canManage,
  canManageCommissions,
  initialTab = "agents",
}: AgentPortalViewProps) {
  const [tab, setTab] = useState<TabKey>(() => initialTab);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [allocateTarget, setAllocateTarget] = useState<SalesAgentWithMetrics | null>(null);
  const [submitTarget, setSubmitTarget] = useState<SalesAgentWithMetrics | null>(null);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<AgentSubmissionWithAgent | null>(null);
  const [selectedAccrualIds, setSelectedAccrualIds] = useState<Set<string>>(new Set());
  const [bundleOpen, setBundleOpen] = useState(false);

  const bundleableAccruals = accruals.filter((a) => a.status === "PENDING" || a.status === "APPROVED");
  const selectedAccruals = bundleableAccruals.filter((a) => selectedAccrualIds.has(a.id));
  const selectedAgentId = selectedAccruals[0]?.sales_agent_id ?? null;

  const toggleAccrualSelection = (accrual: CommissionAccrualWithContext) => {
    setSelectedAccrualIds((prev) => {
      const next = new Set(prev);
      if (next.has(accrual.id)) {
        next.delete(accrual.id);
        return next;
      }
      // Bundling spans one agent at a time — starting a new agent's
      // selection clears whatever was picked for a different one.
      if (selectedAgentId && selectedAgentId !== accrual.sales_agent_id) {
        next.clear();
      }
      next.add(accrual.id);
      return next;
    });
  };

  const activeAgents = agents.filter((a) => a.status === "ACTIVE").length;
  const totalConverted = agents.reduce((sum, a) => sum + a.metrics.convertedCount, 0);
  const totalPendingCommission = agents.reduce((sum, a) => sum + a.metrics.pendingCommission, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agent / Sub-Agent Portal"
        breadcrumb={[{ title: "Relationships", link: "#" }, { title: "Agent / Sub-Agent Portal", link: "/relationships/agent-portal" }]}
        subTitle="Agent directory, package allocations, booking submissions and commission tracking. Invite an agent to sign in at their own portal to submit prospects directly."
        action={
          canManage &&
          (tab === "agents" ? (
            <Button onClick={() => setAddAgentOpen(true)}>
              <Plus /> New agent
            </Button>
          ) : tab === "commissions" && canManageCommissions ? (
            <Button onClick={() => setAddRuleOpen(true)}>
              <Plus /> New commission rule
            </Button>
          ) : null)
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Agents" value={String(agents.length)} />
        <KpiCard title="Active" value={String(activeAgents)} />
        <KpiCard title="Converted submissions" value={String(totalConverted)} />
        <KpiCard title="Pending commission" value={formatExactCurrency(totalPendingCommission)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "agents" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {agents.length === 0 ? (
            <EmptyState
              icon={<Handshake className="size-8" />}
              title="No agents yet"
              description={canManage ? "Add the first agent." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Agent", "Allocated seats", "Submissions", "Converted", "Pending", "Status", "Portal", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {agents.map((a) => (
                  <TableRow key={a.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{a.name}</p>
                      {a.agency_name && <p className="text-[11px] text-muted-foreground">{a.agency_name}</p>}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                      {a.metrics.usedSeats}/{a.metrics.allocatedSeats}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{a.metrics.submissionCount}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{a.metrics.convertedCount}</TableCell>
                    <TableCell className="px-3 py-3 text-sm text-foreground">{formatExactCurrency(a.metrics.pendingCommission)}</TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage ? (
                        <Select
                          value={a.status}
                          onValueChange={async (v) => {
                            const result = await updateSalesAgentStatusAction(a.id, v as SalesAgentStatus);
                            if (!result.ok) return toast.add({ title: result.error ?? "Could not update status" });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTIVE">Active</SelectItem>
                            <SelectItem value="SUSPENDED">Suspended</SelectItem>
                            <SelectItem value="INACTIVE">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <ToneBadge tone={AGENT_STATUS_TONE[a.status]} label={a.status} />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {a.portal_user_id ? (
                        <ToneBadge tone="success" label="Active" />
                      ) : a.portal_invited_at ? (
                        <ToneBadge tone="info" label="Invited" />
                      ) : canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const result = await inviteSalesAgentToPortalAction(a.id);
                            if (!result.ok) return toast.add({ title: result.error ?? "Could not invite" });
                            toast.add({ title: "Invited" });
                          }}
                        >
                          Invite
                        </Button>
                      ) : (
                        <ToneBadge tone="neutral" label="Not invited" />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => setAllocateTarget(a)}>Allocate</Button>
                          <Button size="sm" variant="ghost" onClick={() => setSubmitTarget(a)}>Log submission</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "submissions" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {submissions.length === 0 ? (
            <EmptyState title="No submissions logged yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Lead", "Agent", "Status", "Logged", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {submissions.map((s) => (
                  <TableRow key={s.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{s.lead_name}</p>
                      {s.lead_contact && <p className="text-[11px] text-muted-foreground">{s.lead_contact}</p>}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">{s.agentName}</TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage ? (
                        <Select
                          value={s.status}
                          onValueChange={async (v) => {
                            const result = await updateSubmissionStatusAction(s.id, v as AgentSubmissionStatus);
                            if (!result.ok) return toast.add({ title: result.error ?? "Could not update status" });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(SUBMISSION_STATUS_LABELS) as AgentSubmissionStatus[]).map((status) => (
                              <SelectItem key={status} value={status}>{SUBMISSION_STATUS_LABELS[status]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <ToneBadge tone={SUBMISSION_STATUS_TONE[s.status]} label={SUBMISSION_STATUS_LABELS[s.status]} />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                    <TableCell className="px-3 py-3">
                      {canManageCommissions && s.status === "CONVERTED" && (
                        <Button size="sm" variant="outline" onClick={() => setGrantTarget(s)}>Grant commission</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "commissions" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-foreground">Commission rules</p>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {commissionRules.length === 0 ? (
              <EmptyState title="No commission rules yet" description={canManageCommissions ? "Create one first." : undefined} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Name", "Rate", "Scope", "Active"].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {commissionRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{rule.name}</TableCell>
                      <TableCell className="px-3 py-3 text-xs font-number text-foreground">{rule.rate_percentage}%</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {rule.sales_agent_id ? "One agent" : "Any agent (default)"}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <ToneBadge tone={rule.is_active ? "success" : "neutral"} label={rule.is_active ? "Active" : "Inactive"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Accruals</p>
            {canManageCommissions && selectedAccrualIds.size > 0 && (
              <Button size="sm" onClick={() => setBundleOpen(true)}>
                Bundle {selectedAccrualIds.size} into settlement
              </Button>
            )}
          </div>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {accruals.length === 0 ? (
              <EmptyState title="No commissions granted yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["", "Agent", "Rule", "Amount", "Status", ""].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {accruals.map((a) => {
                    const bundleable = a.status === "PENDING" || a.status === "APPROVED";
                    const disabledForSelection = Boolean(selectedAgentId) && selectedAgentId !== a.sales_agent_id;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="px-3 py-3">
                          {canManageCommissions && bundleable && (
                            <Checkbox
                              checked={selectedAccrualIds.has(a.id)}
                              disabled={disabledForSelection}
                              onCheckedChange={() => toggleAccrualSelection(a)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3 text-sm text-foreground">{a.agentName}</TableCell>
                        <TableCell className="px-3 py-3 text-xs text-foreground">{a.ruleName}</TableCell>
                        <TableCell className="px-3 py-3 text-sm text-foreground">{formatExactCurrency(a.amount)}</TableCell>
                        <TableCell className="px-3 py-3">
                          <ToneBadge tone={ACCRUAL_STATUS_TONE[a.status]} label={a.status} />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          {canManageCommissions && a.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const result = await updateCommissionAccrualStatusAction(a.id, "APPROVED");
                                if (!result.ok) return toast.add({ title: result.error ?? "Could not approve" });
                              }}
                            >
                              Approve
                            </Button>
                          )}
                          {canManageCommissions && a.status === "APPROVED" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const result = await updateCommissionAccrualStatusAction(a.id, "PAID");
                                if (!result.ok) return toast.add({ title: result.error ?? "Could not mark paid" });
                              }}
                            >
                              Mark paid
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>

          <p className="text-sm font-medium text-foreground">Settlements</p>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {settlements.length === 0 ? (
              <EmptyState title="No settlements yet" description="Bundle approved commissions above to create one." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Agent", "Period", "Commissions", "Total", "Status", "Paid"].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {settlements.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{s.agentName}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {formatDate(s.period_start)} – {formatDate(s.period_end)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs font-number text-foreground">{s.accrualCount}</TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{formatExactCurrency(s.totalAmount)}</TableCell>
                      <TableCell className="px-3 py-3">
                        <ToneBadge tone={s.status === "PAID" ? "success" : "info"} label={s.status} />
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {s.paid_at ? formatDate(s.paid_at) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <AddAgentDialog open={addAgentOpen} onClose={() => setAddAgentOpen(false)} />
      {allocateTarget && (
        <AllocatePackageDialog agent={allocateTarget} packages={packages} onClose={() => setAllocateTarget(null)} />
      )}
      {submitTarget && (
        <LogSubmissionDialog agent={submitTarget} packages={packages} onClose={() => setSubmitTarget(null)} />
      )}
      <AddCommissionRuleDialog open={addRuleOpen} onClose={() => setAddRuleOpen(false)} agents={agents} />
      {grantTarget && (
        <GrantCommissionDialog
          submission={grantTarget}
          rules={commissionRules.filter((r) => r.is_active && (!r.sales_agent_id || r.sales_agent_id === grantTarget.sales_agent_id))}
          onClose={() => setGrantTarget(null)}
        />
      )}
      {bundleOpen && selectedAgentId && (
        <BundleSettlementDialog
          agentName={selectedAccruals[0]?.agentName ?? "this agent"}
          salesAgentId={selectedAgentId}
          accrualIds={[...selectedAccrualIds]}
          totalAmount={selectedAccruals.reduce((sum, a) => sum + a.amount, 0)}
          onClose={() => setBundleOpen(false)}
          onDone={() => setSelectedAccrualIds(new Set())}
        />
      )}
    </div>
  );
}

function BundleSettlementDialog({
  agentName,
  salesAgentId,
  accrualIds,
  totalAmount,
  onClose,
  onDone,
}: {
  agentName: string;
  salesAgentId: string;
  accrualIds: string[];
  totalAmount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createSettlementAction({ salesAgentId, periodStart, periodEnd, accrualIds });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create settlement.");
      return;
    }
    toast.add({ title: "Settlement created and marked paid" });
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>Bundle into settlement — {agentName}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-xs text-muted-foreground">
            {accrualIds.length} commission{accrualIds.length === 1 ? "" : "s"} totalling {formatExactCurrency(totalAmount)}{" "}
            will be marked paid as part of this settlement.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Period start</label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Period end</label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !periodStart || !periodEnd}>
            {submitting ? "Creating…" : "Create settlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [creditLimit, setCreditLimit] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createSalesAgentAction({
      name,
      agencyName: agencyName || null,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      creditLimit: creditLimit > 0 ? creditLimit : null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add agent.");
      return;
    }
    toast.add({ title: "Agent added" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>New agent</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agency name (optional)</label>
            <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Phone</label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Credit limit (optional)</label>
            <CurrencyInput value={creditLimit} onValueChange={(v) => setCreditLimit(v === "" ? 0 : v)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>{submitting ? "Adding…" : "Add agent"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocatePackageDialog({
  agent,
  packages,
  onClose,
}: {
  agent: SalesAgentWithMetrics;
  packages: PackageTemplateOption[];
  onClose: () => void;
}) {
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [seats, setSeats] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!packageId) {
      setError("Choose a package.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createAgentAllocationAction({
      salesAgentId: agent.id,
      packageId,
      allocatedSeats: Number(seats) || 0,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not allocate.");
      return;
    }
    toast.add({ title: "Package allocated" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>Allocate a package — {agent.name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Package</label>
            <Select value={packageId} onValueChange={(v) => setPackageId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder={packages.length === 0 ? "No packages" : undefined} /></SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Allocated seats</label>
            <Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !seats}>{submitting ? "Saving…" : "Allocate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogSubmissionDialog({
  agent,
  packages,
  onClose,
}: {
  agent: SalesAgentWithMetrics;
  packages: PackageTemplateOption[];
  onClose: () => void;
}) {
  const [leadName, setLeadName] = useState("");
  const [leadContact, setLeadContact] = useState("");
  const [packageId, setPackageId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createAgentSubmissionAction({
      salesAgentId: agent.id,
      packageId: packageId || null,
      leadName,
      leadContact: leadContact || null,
      notes: notes || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not log submission.");
      return;
    }
    toast.add({ title: "Submission logged" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>Log a submission — {agent.name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Lead&apos;s name</label>
            <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contact (optional)</label>
            <Input value={leadContact} onChange={(e) => setLeadContact(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Package (optional)</label>
            <Select value={packageId} onValueChange={(v) => setPackageId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="No package chosen yet" /></SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !leadName.trim()}>{submitting ? "Logging…" : "Log submission"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCommissionRuleDialog({
  open,
  onClose,
  agents,
}: {
  open: boolean;
  onClose: () => void;
  agents: SalesAgentWithMetrics[];
}) {
  const [name, setName] = useState("");
  const [ratePercentage, setRatePercentage] = useState("");
  const [salesAgentId, setSalesAgentId] = useState<string>("ANY");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createCommissionRuleAction({
      name,
      ratePercentage: Number(ratePercentage) || 0,
      salesAgentId: salesAgentId === "ANY" ? null : salesAgentId,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create rule.");
      return;
    }
    toast.add({ title: "Commission rule created" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>New commission rule</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard 5%" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rate (%)</label>
            <Input type="number" value={ratePercentage} onChange={(e) => setRatePercentage(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Scope</label>
            <Select value={salesAgentId} onValueChange={(v) => setSalesAgentId(v ?? "ANY")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any agent (default)</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim() || !ratePercentage}>{submitting ? "Creating…" : "Create rule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantCommissionDialog({
  submission,
  rules,
  onClose,
}: {
  submission: AgentSubmissionWithAgent;
  rules: CommissionRuleRow[];
  onClose: () => void;
}) {
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? "");
  const [amount, setAmount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!ruleId) {
      setError("Choose a commission rule.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await grantCommissionAction({
      salesAgentId: submission.sales_agent_id,
      commissionRuleId: ruleId,
      bookingId: submission.converted_booking_id,
      amount,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not grant commission.");
      return;
    }
    toast.add({ title: "Commission granted" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>Grant commission — {submission.lead_name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active commission rules for this agent. Create one first.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Rule</label>
                <Select value={ruleId} onValueChange={(v) => setRuleId(v ?? "")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rules.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name} ({r.rate_percentage}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Amount</label>
                <CurrencyInput value={amount} onValueChange={(v) => setAmount(v === "" ? 0 : v)} />
              </div>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || rules.length === 0}>{submitting ? "Granting…" : "Grant commission"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
