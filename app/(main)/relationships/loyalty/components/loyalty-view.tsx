"use client";

import { useMemo, useState } from "react";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
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
import { Textarea } from "@/components/ui/textarea";
import SearchInput from "@/components/ui/search-input";
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
import { Heart, Plus } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import type {
  LoyaltyPilgrimSummary,
  LoyaltyRedemptionStatus,
  LoyaltyRedemptionWithPilgrim,
  LoyaltyTierRow,
} from "@/lib/types/loyalty";
import type { Tone } from "@/lib/ui/tone";

import {
  addPointEntryAction,
  createLoyaltyTierAction,
  createRedemptionAction,
  updateRedemptionStatusAction,
} from "../actions";

const REDEMPTION_STATUS_TONE: Record<LoyaltyRedemptionStatus, Tone> = {
  PENDING: "warning",
  APPROVED: "info",
  FULFILLED: "success",
  CANCELLED: "danger",
};

type TabKey = "pilgrims" | "tiers" | "redemptions";

interface LoyaltyViewProps {
  pilgrims: LoyaltyPilgrimSummary[];
  tiers: LoyaltyTierRow[];
  redemptions: LoyaltyRedemptionWithPilgrim[];
  canManage: boolean;
}

export default function LoyaltyView({
  pilgrims,
  tiers,
  redemptions,
  canManage,
}: LoyaltyViewProps) {
  const [tab, setTab] = useState<TabKey>("pilgrims");
  const [search, setSearch] = useState("");
  const [adjustTarget, setAdjustTarget] =
    useState<LoyaltyPilgrimSummary | null>(null);
  const [redeemTarget, setRedeemTarget] =
    useState<LoyaltyPilgrimSummary | null>(null);
  const [addTierOpen, setAddTierOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return pilgrims;
    return pilgrims.filter(
      (p) =>
        p.fullName.toLowerCase().includes(needle) ||
        p.reference.toLowerCase().includes(needle),
    );
  }, [pilgrims, search]);

  const repeatCount = pilgrims.filter((p) => p.isRepeat).length;
  const pendingRedemptions = redemptions.filter(
    (r) => r.status === "PENDING",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Loyalty & Repeat Umrah"
        breadcrumb={[
          { title: "Relationships", link: "#" },
          { title: "Loyalty & Repeat Umrah", link: "/relationships/loyalty" },
        ]}
        subTitle="Repeat-pilgrim identification, a points ledger, and reward redemptions — tiers and balances are computed live."
        action={
          canManage &&
          tab === "tiers" && (
            <Button onClick={() => setAddTierOpen(true)}>
              <Plus /> New tier
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Pilgrims tracked" value={String(pilgrims.length)} />
        <KpiCard title="Repeat pilgrims" value={String(repeatCount)} />
        <KpiCard title="Tiers" value={String(tiers.length)} />
        <KpiCard
          title="Pending redemptions"
          value={String(pendingRedemptions)}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="pilgrims">Pilgrims</TabsTrigger>
          <TabsTrigger value="tiers">Tiers</TabsTrigger>
          <TabsTrigger value="redemptions">Redemptions</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "pilgrims" && (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search pilgrims…"
          />
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Heart className="size-8" />}
                title="No pilgrims with bookings yet"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Pilgrim", "Groups", "Repeat", "Points", "Tier", ""].map(
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
                  {filtered.map((p) => (
                    <TableRow key={p.pilgrimId} className="hover:bg-muted/40">
                      <TableCell className="px-3 py-3">
                        <p className="text-sm text-foreground">{p.fullName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.reference}
                        </p>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {p.groupCount}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {p.isRepeat ? (
                          <ToneBadge tone="success" label="Repeat" />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {p.pointsBalance}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {p.tierName ? (
                          <Badge variant="secondary">{p.tierName}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAdjustTarget(p)}
                            >
                              Adjust points
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRedeemTarget(p)}
                            >
                              Redeem
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
        </>
      )}

      {tab === "tiers" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {tiers.length === 0 ? (
            <EmptyState
              title="No tiers configured"
              description={canManage ? "Create the first tier." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Tier", "Min. points", "Benefits"].map((label) => (
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
                {tiers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {t.name}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                      {t.min_points}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {t.benefits ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "redemptions" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {redemptions.length === 0 ? (
            <EmptyState title="No redemptions yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Pilgrim",
                    "Reward",
                    "Points",
                    "Status",
                    "Requested",
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
                {redemptions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-3 py-3 text-sm text-foreground">
                      {r.pilgrimName}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {r.reward_description}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                      {r.points_spent}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <ToneBadge
                        tone={REDEMPTION_STATUS_TONE[r.status]}
                        label={r.status}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {formatDate(r.created_at)}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage && r.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const result = await updateRedemptionStatusAction(
                              r.id,
                              "APPROVED",
                            );
                            if (!result.ok)
                              return toast.add({
                                title: result.error ?? "Could not approve",
                              });
                          }}
                        >
                          Approve
                        </Button>
                      )}
                      {canManage && r.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const result = await updateRedemptionStatusAction(
                              r.id,
                              "FULFILLED",
                            );
                            if (!result.ok)
                              return toast.add({
                                title: result.error ?? "Could not fulfill",
                              });
                          }}
                        >
                          Mark fulfilled
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {adjustTarget && (
        <AdjustPointsDialog
          pilgrim={adjustTarget}
          onClose={() => setAdjustTarget(null)}
        />
      )}
      {redeemTarget && (
        <CreateRedemptionDialog
          pilgrim={redeemTarget}
          onClose={() => setRedeemTarget(null)}
        />
      )}
      <AddTierDialog
        open={addTierOpen}
        onClose={() => setAddTierOpen(false)}
        nextSortOrder={tiers.length}
      />
    </div>
  );
}

function AdjustPointsDialog({
  pilgrim,
  onClose,
}: {
  pilgrim: LoyaltyPilgrimSummary;
  onClose: () => void;
}) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await addPointEntryAction({
      pilgrimId: pilgrim.pilgrimId,
      points: Number(points) || 0,
      entryType: "MANUAL_ADJUSTMENT",
      reason,
      referenceBookingId: null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not adjust points.");
      return;
    }
    toast.add({ title: "Points adjusted" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Adjust points — {pilgrim.fullName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Points (negative to deduct)
            </label>
            <Input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="e.g. 500 or -200"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Reason
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !points || !reason.trim()}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRedemptionDialog({
  pilgrim,
  onClose,
}: {
  pilgrim: LoyaltyPilgrimSummary;
  onClose: () => void;
}) {
  const [rewardDescription, setRewardDescription] = useState("");
  const [pointsSpent, setPointsSpent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createRedemptionAction({
      pilgrimId: pilgrim.pilgrimId,
      rewardDescription,
      pointsSpent: Number(pointsSpent) || 0,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create redemption.");
      return;
    }
    toast.add({ title: "Redemption requested" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Redeem points — {pilgrim.fullName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-xs text-muted-foreground">
            Current balance: {pilgrim.pointsBalance} points
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Reward
            </label>
            <Input
              value={rewardDescription}
              onChange={(e) => setRewardDescription(e.target.value)}
              placeholder="e.g. Free airport transfer"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Points to spend
            </label>
            <Input
              type="number"
              value={pointsSpent}
              onChange={(e) => setPointsSpent(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !rewardDescription.trim() || !pointsSpent}
          >
            {submitting ? "Requesting…" : "Request redemption"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddTierDialog({
  open,
  onClose,
  nextSortOrder,
}: {
  open: boolean;
  onClose: () => void;
  nextSortOrder: number;
}) {
  const [name, setName] = useState("");
  const [minPoints, setMinPoints] = useState("0");
  const [benefits, setBenefits] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createLoyaltyTierAction({
      name,
      minPoints: Number(minPoints) || 0,
      benefits: benefits || null,
      sortOrder: nextSortOrder,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create tier.");
      return;
    }
    toast.add({ title: "Tier created" });
    setName("");
    setMinPoints("0");
    setBenefits("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>New loyalty tier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gold"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Minimum points
            </label>
            <Input
              type="number"
              value={minPoints}
              onChange={(e) => setMinPoints(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Benefits
            </label>
            <Textarea
              value={benefits}
              onChange={(e) => setBenefits(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create tier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
