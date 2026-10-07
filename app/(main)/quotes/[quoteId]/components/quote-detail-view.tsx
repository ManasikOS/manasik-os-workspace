"use client";

import { useState, useTransition } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import Link from "next/link";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  PackageCheck,
  XCircle,
} from "lucide-react";

import type { QuotesCapabilities } from "@/lib/access/quotes-access";
import type { LeadActivityRow, LeadQuoteRow, LeadRow } from "@/lib/types/leads";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE } from "@/lib/quotes/status";
import {
  formatDate,
  formatExactLKR,
  ROOM_PREFERENCE_LABELS,
} from "@/app/(main)/leads/utils";
import { TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import {
  cancelQuoteAction,
  convertQuoteToBookingAction,
  createQuoteRevisionAction,
  explainQuoteRiskAction,
  extendQuoteValidityAction,
  updateQuoteStatusFromDetailAction,
} from "../actions";

export interface QuoteDetailData {
  quote: LeadQuoteRow;
  lead: LeadRow | null;
  activity: LeadActivityRow[];
  revisions: LeadQuoteRow[];
  supersedes: LeadQuoteRow | null;
  currentPricePerPerson: number | null;
  bookingReference: string | null;
  signals: {
    expiringWithoutFollowUp: boolean;
    discountOutsideBand: boolean;
    priceDiffersFromCurrent: boolean;
  };
  discountBandPercent: number;
}

const TAB_IDS = [
  "overview",
  "commercials",
  "payment-plan",
  "activity",
] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  commercials: "Commercials",
  "payment-plan": "Payment Plan",
  activity: "Activity",
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default function QuoteDetailView({
  data,
  can,
}: {
  data: QuoteDetailData;
  can: QuotesCapabilities;
}) {
  const router = useRouter();
  const { quote, lead, activity, revisions, supersedes, signals } = data;
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [riskExplanation, setRiskExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const explainRisk = () => {
    setExplaining(true);
    startTransition(async () => {
      const result = await explainQuoteRiskAction(quote.id);
      setExplaining(false);
      setRiskExplanation(
        result.ok
          ? (result.summary ?? null)
          : (result.error ?? "Could not generate an explanation."),
      );
    });
  };

  const isOpen =
    quote.status === "DRAFT" ||
    quote.status === "PENDING_APPROVAL" ||
    quote.status === "SENT" ||
    quote.status === "VIEWED";

  const decide = (status: "ACCEPTED" | "DECLINED") =>
    startTransition(async () => {
      const result = await updateQuoteStatusFromDetailAction({
        quoteId: quote.id,
        status,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not update quote",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: `Quote marked ${QUOTE_STATUS_LABEL[status].toLowerCase()}`,
      });
    });

  const revise = () =>
    startTransition(async () => {
      const result = await createQuoteRevisionAction(quote.id);
      if (!result.ok) {
        toast.add({
          title: "Could not draft a revision",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Revision drafted" });
      if (result.quoteId) router.push(`/quotes/${result.quoteId}`);
    });

  const extend = (days: number) =>
    startTransition(async () => {
      const result = await extendQuoteValidityAction({
        quoteId: quote.id,
        days,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not extend validity",
          description: result.error,
        });
        return;
      }
      toast.add({ title: `Validity extended by ${days} day(s)` });
    });

  const confirmCancel = () =>
    startTransition(async () => {
      const result = await cancelQuoteAction({
        quoteId: quote.id,
        reason: cancelReason,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not cancel quote",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Quote cancelled" });
      setCancelling(false);
    });

  const convert = () =>
    startTransition(async () => {
      const result = await convertQuoteToBookingAction({
        quoteId: quote.id,
        primaryContactName: lead?.full_name ?? "—",
        primaryContactPhone: lead?.mobile ?? "",
      });
      if (!result.ok) {
        toast.add({
          title: "Could not create booking",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Booking created",
        description: result.bookingReference,
      });
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={quote.reference}
        breadcrumb={[
          { title: "Quotes", link: "/quotes" },
          { title: quote.reference, link: `/quotes/${quote.id}` },
        ]}
        subTitle={lead ? `${lead.full_name} · ${lead.mobile}` : "—"}
        action={
          <div className="flex items-center gap-2">
            {can.acceptOnBehalf &&
              (quote.status === "SENT" || quote.status === "VIEWED") && (
                <Button
                  size="sm"
                  variant="outline_without_border"
                  onClick={() => decide("ACCEPTED")}
                  disabled={pending}
                >
                  <CheckCircle2 /> Accept
                </Button>
              )}
            {can.rejectQuote &&
              (quote.status === "SENT" || quote.status === "VIEWED") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decide("DECLINED")}
                  disabled={pending}
                >
                  <XCircle /> Reject
                </Button>
              )}
            {can.createQuote && quote.status !== "DRAFT" && (
              <Button
                size="sm"
                variant="outline_without_border"
                onClick={revise}
                disabled={pending}
              >
                <History /> Revise
              </Button>
            )}
            {can.convertToBooking && quote.status === "ACCEPTED" && (
              <Button size="sm" onClick={convert} disabled={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PackageCheck />
                )}
                {quote.booking_id ? "View booking" : "Convert to booking"}
              </Button>
            )}
            {can.editQuote && isOpen && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCancelling(true)}
                disabled={pending}
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <ToneBadge
          tone={QUOTE_STATUS_TONE[quote.status]}
          label={QUOTE_STATUS_LABEL[quote.status]}
        />
        {supersedes && (
          <Link
            href={`/quotes/${supersedes.id}`}
            className="text-xs text-muted-foreground underline"
          >
            Revision of {supersedes.reference}
          </Link>
        )}
        {revisions.length > 0 && (
          <Link
            href={`/quotes/${revisions[0].id}`}
            className="text-xs text-muted-foreground underline"
          >
            {revisions.length} revision{revisions.length === 1 ? "" : "s"} →
          </Link>
        )}
        {data.bookingReference && (
          <Badge variant="secondary">Booked: {data.bookingReference}</Badge>
        )}
      </div>

      {(signals.expiringWithoutFollowUp ||
        signals.discountOutsideBand ||
        signals.priceDiffersFromCurrent) && (
        <Card className={cn("gap-2", TONE_STAT_CARD.warning)}>
          {signals.expiringWithoutFollowUp && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                TONE_TEXT.warning,
              )}
            >
              <AlertTriangle className="size-3.5" /> Expiring within 72 hours
              with no follow-up logged.
            </p>
          )}
          {signals.discountOutsideBand && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                TONE_TEXT.warning,
              )}
            >
              <AlertTriangle className="size-3.5" /> Discount exceeds the{" "}
              {data.discountBandPercent}% approval-free band.
            </p>
          )}
          {signals.priceDiffersFromCurrent && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                TONE_TEXT.warning,
              )}
            >
              <AlertTriangle className="size-3.5" /> Snapshot price differs from
              the group&apos;s current pricing
              {data.currentPricePerPerson !== null &&
                ` (now ${formatExactLKR(data.currentPricePerPerson)}/person)`}
              .
            </p>
          )}
          {!riskExplanation && (
            <Button
              size="sm"
              variant="outline_without_border"
              className="self-start mt-1"
              onClick={explainRisk}
              disabled={explaining}
            >
              {explaining ? (
                <Loader2 className="animate-spin" />
              ) : (
                "Ask Manasik Copilot to explain"
              )}
            </Button>
          )}
          {riskExplanation && (
            <p className="text-xs text-foreground pt-1 border-t border-border/40">
              {riskExplanation}
            </p>
          )}
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          {TAB_IDS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {TAB_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "overview" && (
        <Card className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
          <Fact label="Package" value={quote.pricing_snapshot.packageName} />
          <Fact
            label="Group"
            value={quote.pricing_snapshot.groupLabel ?? "—"}
          />
          <Fact
            label="Dates"
            value={quote.pricing_snapshot.groupDates ?? "—"}
          />
          <Fact
            label="Room preference"
            value={ROOM_PREFERENCE_LABELS[quote.room_preference]}
          />
          <Fact
            label="Travellers"
            value={`${quote.adults} adult${quote.adults === 1 ? "" : "s"}${quote.children > 0 ? `, ${quote.children} child${quote.children === 1 ? "" : "ren"}` : ""}`}
          />
          <Fact
            label="Sent"
            value={quote.sent_at ? formatDate(quote.sent_at) : "Not yet sent"}
          />
          <Fact label="Valid until" value={formatDate(quote.valid_until)} />
          <Fact label="Created by" value={quote.created_by_name} />
          {quote.cancelled_at && (
            <Fact
              label="Cancelled"
              value={`${formatDate(quote.cancelled_at)} — ${quote.rejection_reason ?? ""}`}
            />
          )}
        </Card>
      )}

      {tab === "commercials" && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Fact
              label="Price per person"
              value={
                quote.price_per_person !== null
                  ? formatExactLKR(quote.price_per_person)
                  : "—"
              }
            />
            <Fact label="Total" value={formatExactLKR(quote.total_lkr)} />
            <Fact label="Deposit" value={formatExactLKR(quote.deposit_lkr)} />
            <Fact
              label="Discount"
              value={
                quote.discount_amount > 0
                  ? formatExactLKR(quote.discount_amount)
                  : "None"
              }
            />
            {quote.discount_reason && (
              <Fact label="Discount reason" value={quote.discount_reason} />
            )}
            {quote.discount_approved_by && (
              <Fact
                label="Discount approved by"
                value={quote.discount_approved_by}
              />
            )}
          </div>
          {quote.inclusions.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Inclusions
              </p>
              <ul className="text-sm text-foreground list-disc pl-5">
                {quote.inclusions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {quote.exclusions.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Exclusions
              </p>
              <ul className="text-sm text-foreground list-disc pl-5">
                {quote.exclusions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {(quote.status === "SENT" || quote.status === "VIEWED") &&
            can.sendQuote && (
              <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                <span className="text-xs text-muted-foreground">
                  Extend validity:
                </span>
                <Button
                  size="sm"
                  variant="outline_without_border"
                  onClick={() => extend(3)}
                  disabled={pending}
                >
                  +3 days
                </Button>
                <Button
                  size="sm"
                  variant="outline_without_border"
                  onClick={() => extend(7)}
                  disabled={pending}
                >
                  +7 days
                </Button>
              </div>
            )}
        </Card>
      )}

      {tab === "payment-plan" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {quote.payment_milestones.length === 0 ? (
            <EmptyState
              title="No instalment schedule on this quote"
              description="This quote was sent with only a total and deposit — converting it will use the departure group's own payment schedule."
            />
          ) : (
            <ul className="divide-y divide-border/20">
              {quote.payment_milestones.map((m, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="text-foreground">{m.label}</span>
                  <span className="text-muted-foreground">
                    {m.dueDate ? formatDate(m.dueDate) : m.dueLabel}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatExactLKR(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "activity" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-border/20">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <p className="text-sm text-foreground">{a.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {a.actor_name} · {formatDate(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel quote</DialogTitle>
            <DialogDescription>{quote.reference}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why is this quote being cancelled?"
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Back
            </Button>
            <Button
              onClick={confirmCancel}
              disabled={pending || !cancelReason.trim()}
            >
              {pending ? <Loader2 className="animate-spin" /> : "Cancel quote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
