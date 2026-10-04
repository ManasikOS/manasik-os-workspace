"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import { Gift, Plus } from "lucide-react";

import { formatDate, formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type {
  ReferralStatus,
  ReferralWithReferrer,
  ReferrerType,
  ReferrerWithMetrics,
  RewardAccrualStatus,
  RewardAccrualWithContext,
  RewardRuleRow,
  RewardType,
} from "@/lib/types/referrals";
import type { Tone } from "@/lib/ui/tone";

import {
  createReferralAction,
  createReferrerAction,
  createRewardRuleAction,
  grantRewardAction,
  updateReferralStatusAction,
  updateRewardAccrualStatusAction,
} from "../actions";

const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  INVITED: "Invited",
  CONTACTED: "Contacted",
  CONVERTED: "Converted",
  EXPIRED: "Expired",
  REJECTED: "Rejected",
};

const REFERRAL_STATUS_TONE: Record<ReferralStatus, Tone> = {
  INVITED: "neutral",
  CONTACTED: "info",
  CONVERTED: "success",
  EXPIRED: "warning",
  REJECTED: "danger",
};

const ACCRUAL_STATUS_TONE: Record<RewardAccrualStatus, Tone> = {
  PENDING: "warning",
  APPROVED: "info",
  PAID: "success",
  CANCELLED: "danger",
};

const REFERRER_TYPE_LABELS: Record<ReferrerType, string> = {
  PILGRIM: "Pilgrim",
  LEAD: "Lead",
  STAFF: "Staff",
  EXTERNAL: "External",
};

type TabKey = "referrers" | "referrals" | "rewards";

interface ReferralsViewProps {
  referrers: ReferrerWithMetrics[];
  referrals: ReferralWithReferrer[];
  rewardRules: RewardRuleRow[];
  accruals: RewardAccrualWithContext[];
  canManage: boolean;
  canManageRewards: boolean;
}

export default function ReferralsView({
  referrers,
  referrals,
  rewardRules,
  accruals,
  canManage,
  canManageRewards,
}: ReferralsViewProps) {
  const [tab, setTab] = useState<TabKey>("referrers");
  const [addReferrerOpen, setAddReferrerOpen] = useState(false);
  const [addReferralOpen, setAddReferralOpen] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState<ReferralWithReferrer | null>(null);

  const convertedCount = referrals.filter((r) => r.status === "CONVERTED").length;
  const totalRewards = accruals
    .filter((a) => a.status !== "CANCELLED")
    .reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Referrals"
        breadcrumb={[{ title: "Grow", link: "#" }, { title: "Referrals", link: "/referrals" }]}
        subTitle="Referral pipeline from invite to converted booking, with reward rules and payout tracking."
        action={
          canManage &&
          (tab === "referrers" ? (
            <Button onClick={() => setAddReferrerOpen(true)}>
              <Plus /> New referrer
            </Button>
          ) : tab === "referrals" ? (
            <Button onClick={() => setAddReferralOpen(true)} disabled={referrers.length === 0}>
              <Plus /> Log referral
            </Button>
          ) : canManageRewards ? (
            <Button onClick={() => setAddRuleOpen(true)}>
              <Plus /> New reward rule
            </Button>
          ) : null)
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Referrers" value={String(referrers.length)} />
        <KpiCard title="Referrals" value={String(referrals.length)} />
        <KpiCard title="Converted" value={String(convertedCount)} />
        <KpiCard title="Rewards granted" value={formatExactCurrency(totalRewards)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="referrers">Referrers</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="rewards">Rewards</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "referrers" && (
        <DataTableSurface rowCount={referrers.length}>
          {referrers.length === 0 ? (
            <EmptyState
              icon={<Gift className="size-8" />}
              title="No referrers yet"
              description={canManage ? "Add the first referrer to start tracking referrals." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Name", "Type", "Code", "Referrals", "Converted", "Rewards"].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {referrers.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-3 text-sm text-foreground">{r.name}</TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">{REFERRER_TYPE_LABELS[r.referrer_type]}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-muted-foreground">{r.referral_code}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{r.metrics.referralCount}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{r.metrics.convertedCount}</TableCell>
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {formatExactCurrency(r.metrics.totalRewardAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataTableSurface>
      )}

      {tab === "referrals" && (
        <DataTableSurface rowCount={referrals.length}>
          {referrals.length === 0 ? (
            <EmptyState title="No referrals logged yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Referred", "Referrer", "Status", "Logged", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {referrals.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{r.referred_name}</p>
                      {r.referred_contact && <p className="text-[11px] text-muted-foreground">{r.referred_contact}</p>}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {r.referrerName} <span className="text-muted-foreground">({r.referrerCode})</span>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage ? (
                        <Select
                          value={r.status}
                          onValueChange={async (v) => {
                            const result = await updateReferralStatusAction(r.id, v as ReferralStatus);
                            if (!result.ok) return toast.add({ title: result.error ?? "Could not update status" });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[]).map((status) => (
                              <SelectItem key={status} value={status}>
                                {REFERRAL_STATUS_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <ToneBadge tone={REFERRAL_STATUS_TONE[r.status]} label={REFERRAL_STATUS_LABELS[r.status]} />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                    <TableCell className="px-3 py-3">
                      {canManageRewards && r.status === "CONVERTED" && (
                        <Button size="sm" variant="outline" onClick={() => setGrantOpen(r)}>
                          Grant reward
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataTableSurface>
      )}

      {tab === "rewards" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-foreground">Reward rules</p>
          <DataTableSurface rowCount={rewardRules.length}>
            {rewardRules.length === 0 ? (
              <EmptyState title="No reward rules yet" description={canManageRewards ? "Create one to start granting rewards." : undefined} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Name", "Type", "Value", "Active"].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {rewardRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{rule.name}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">{rule.reward_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {rule.reward_type === "PERCENTAGE_OF_BOOKING" ? `${rule.percentage}%` : formatExactCurrency(rule.amount ?? 0)}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <ToneBadge tone={rule.is_active ? "success" : "neutral"} label={rule.is_active ? "Active" : "Inactive"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTableSurface>

          <p className="text-sm font-medium text-foreground">Accruals</p>
          <DataTableSurface rowCount={accruals.length}>
            {accruals.length === 0 ? (
              <EmptyState title="No rewards granted yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Referred", "Referrer", "Rule", "Amount", "Status", ""].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {accruals.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{a.referredName}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">{a.referrerName}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">{a.ruleName}</TableCell>
                      <TableCell className="px-3 py-3 text-sm text-foreground">{formatExactCurrency(a.amount)}</TableCell>
                      <TableCell className="px-3 py-3">
                        <ToneBadge tone={ACCRUAL_STATUS_TONE[a.status]} label={a.status} />
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {canManageRewards && a.status === "PENDING" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const result = await updateRewardAccrualStatusAction(a.id, "APPROVED");
                              if (!result.ok) return toast.add({ title: result.error ?? "Could not approve" });
                            }}
                          >
                            Approve
                          </Button>
                        )}
                        {canManageRewards && a.status === "APPROVED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const result = await updateRewardAccrualStatusAction(a.id, "PAID");
                              if (!result.ok) return toast.add({ title: result.error ?? "Could not mark paid" });
                            }}
                          >
                            Mark paid
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTableSurface>
        </div>
      )}

      <AddReferrerDialog open={addReferrerOpen} onClose={() => setAddReferrerOpen(false)} />
      <AddReferralDialog open={addReferralOpen} onClose={() => setAddReferralOpen(false)} referrers={referrers} />
      <AddRewardRuleDialog open={addRuleOpen} onClose={() => setAddRuleOpen(false)} />
      {grantOpen && (
        <GrantRewardDialog
          referral={grantOpen}
          rewardRules={rewardRules.filter((r) => r.is_active)}
          onClose={() => setGrantOpen(null)}
        />
      )}
    </div>
  );
}

function AddReferrerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [referrerType, setReferrerType] = useState<ReferrerType>("PILGRIM");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createReferrerAction({
      name,
      referrerType,
      subjectId: null,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add referrer.");
      return;
    }
    toast.add({ title: "Referrer added" });
    setName("");
    setContactPhone("");
    setContactEmail("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>New referrer</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Name</InputGroupText></InputGroupAddon>
            <InputGroupInput value={name} onChange={(e) => setName(e.target.value)} />
          </InputGroup>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={referrerType} onValueChange={(v) => setReferrerType(v as ReferrerType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(REFERRER_TYPE_LABELS) as ReferrerType[]).map((type) => (
                  <SelectItem key={type} value={type}>{REFERRER_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start"><InputGroupText>Phone (optional)</InputGroupText></InputGroupAddon>
              <InputGroupInput value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start"><InputGroupText>Email (optional)</InputGroupText></InputGroupAddon>
              <InputGroupInput value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </InputGroup>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>{submitting ? "Adding…" : "Add referrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddReferralDialog({
  open,
  onClose,
  referrers,
}: {
  open: boolean;
  onClose: () => void;
  referrers: ReferrerWithMetrics[];
}) {
  const [referrerId, setReferrerId] = useState(referrers[0]?.id ?? "");
  const [referredName, setReferredName] = useState("");
  const [referredContact, setReferredContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!referrerId) {
      setError("Choose a referrer.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createReferralAction({
      referrerId,
      referredName,
      referredContact: referredContact || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not log referral.");
      return;
    }
    toast.add({ title: "Referral logged" });
    setReferredName("");
    setReferredContact("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>Log a referral</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Referrer</label>
            <Select value={referrerId} onValueChange={(v) => setReferrerId(v ?? "")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {referrers.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name} ({r.referral_code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Referred person&apos;s name</InputGroupText></InputGroupAddon>
            <InputGroupInput value={referredName} onChange={(e) => setReferredName(e.target.value)} />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Contact (optional)</InputGroupText></InputGroupAddon>
            <InputGroupInput value={referredContact} onChange={(e) => setReferredContact(e.target.value)} />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !referredName.trim()}>{submitting ? "Logging…" : "Log referral"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRewardRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [rewardType, setRewardType] = useState<RewardType>("FIXED_CASH");
  const [amount, setAmount] = useState(0);
  const [percentage, setPercentage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createRewardRuleAction({
      name,
      rewardType,
      amount: rewardType === "PERCENTAGE_OF_BOOKING" ? null : amount || null,
      percentage: rewardType === "PERCENTAGE_OF_BOOKING" ? Number(percentage) || null : null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create rule.");
      return;
    }
    toast.add({ title: "Reward rule created" });
    setName("");
    setAmount(0);
    setPercentage("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>New reward rule</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Name</InputGroupText></InputGroupAddon>
            <InputGroupInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. LKR 5,000 per converted referral" />
          </InputGroup>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={rewardType} onValueChange={(v) => setRewardType(v as RewardType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED_CASH">Fixed cash</SelectItem>
                <SelectItem value="PERCENTAGE_OF_BOOKING">Percentage of booking</SelectItem>
                <SelectItem value="DISCOUNT_VOUCHER">Discount voucher</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rewardType === "PERCENTAGE_OF_BOOKING" ? (
            <InputGroup>
              <InputGroupAddon align="block-start"><InputGroupText>Percentage</InputGroupText></InputGroupAddon>
              <InputGroupInput type="number" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="5" />
            </InputGroup>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Amount</label>
              <CurrencyInput value={amount} onValueChange={(v) => setAmount(v === "" ? 0 : v)} />
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>{submitting ? "Creating…" : "Create rule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantRewardDialog({
  referral,
  rewardRules,
  onClose,
}: {
  referral: ReferralWithReferrer;
  rewardRules: RewardRuleRow[];
  onClose: () => void;
}) {
  const [ruleId, setRuleId] = useState(rewardRules[0]?.id ?? "");
  const [amount, setAmount] = useState(rewardRules[0]?.amount ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!ruleId) {
      setError("Choose a reward rule.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await grantRewardAction({ referralId: referral.id, rewardRuleId: ruleId, amount });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not grant reward.");
      return;
    }
    toast.add({ title: "Reward granted" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader><DialogTitle>Grant reward — {referral.referred_name}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {rewardRules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active reward rules. Create one first.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Reward rule</label>
                <Select
                  value={ruleId}
                  onValueChange={(v) => {
                    setRuleId(v ?? "");
                    const rule = rewardRules.find((r) => r.id === v);
                    if (rule?.amount) setAmount(rule.amount);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rewardRules.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
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
          <Button onClick={submit} disabled={submitting || rewardRules.length === 0}>
            {submitting ? "Granting…" : "Grant reward"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
