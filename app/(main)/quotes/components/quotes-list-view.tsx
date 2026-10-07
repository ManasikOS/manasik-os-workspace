"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { FileSignature, TriangleAlert } from "lucide-react";

import {
  formatDate,
  formatExactCurrency,
} from "@/app/(main)/departure-groups/utils";
import { updateQuoteStatusFromDetailAction } from "@/app/(main)/quotes/[quoteId]/actions";
import { toast } from "@/components/ui/toast";
import type { QuoteStatus } from "@/lib/copilot/sales/types";
import {
  QUOTE_STATUS_LABEL as STATUS_LABELS,
  QUOTE_STATUS_TONE as STATUS_TONE,
  OPEN_QUOTE_STATUSES,
} from "@/lib/quotes/status";
import { TONE_TEXT } from "@/lib/ui/tone";

export interface QuoteListRow {
  id: string;
  leadId: string;
  reference: string;
  contactName: string;
  contactPhone: string;
  status: QuoteStatus;
  packageName: string;
  groupLabel: string | null;
  adults: number;
  children: number;
  totalLkr: number;
  depositLkr: number;
  currency: string;
  validUntil: string;
  sentAt: string | null;
  createdAt: string;
  createdByName: string;
}

type StatusFilter = "OPEN" | QuoteStatus | "ALL";

interface QuotesListViewProps {
  quotes: QuoteListRow[];
  canManage: boolean;
}

export default function QuotesListView({
  quotes,
  canManage,
}: QuotesListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("OPEN");
  const [now] = useState(() => Date.now());

  const isExpiringSoon = (q: QuoteListRow) =>
    (q.status === "SENT" || q.status === "VIEWED") &&
    Date.parse(q.validUntil) - now <= 2 * 24 * 60 * 60 * 1000 &&
    Date.parse(q.validUntil) >= now;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return quotes.filter((q) => {
      if (status === "OPEN" && !OPEN_QUOTE_STATUSES.includes(q.status))
        return false;
      if (status !== "OPEN" && status !== "ALL" && q.status !== status)
        return false;
      if (!needle) return true;
      return [q.reference, q.contactName, q.packageName, q.groupLabel ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, search, status, now]);

  const sentCount = quotes.filter((q) => q.status === "SENT").length;
  const acceptedCount = quotes.filter((q) => q.status === "ACCEPTED").length;
  const expiringSoonCount = quotes.filter(isExpiringSoon).length;
  const conversionRate =
    quotes.length > 0 ? Math.round((acceptedCount / quotes.length) * 100) : 0;

  const decide = async (quote: QuoteListRow, next: QuoteStatus) => {
    const result = await updateQuoteStatusFromDetailAction({
      quoteId: quote.id,
      status: next,
    });
    if (!result.ok) {
      toast.add({ title: "Could not update quote", description: result.error });
      return;
    }
    toast.add({ title: `Quote marked ${STATUS_LABELS[next].toLowerCase()}` });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        breadcrumb={[
          { title: "Sell", link: "#" },
          { title: "Quotes", link: "/quotes" },
        ]}
        subTitle="Every quote across every lead. Quotes are still drafted and sent from each lead's own Send Quote sheet."
        action={null}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Sent" value={String(sentCount)} />
        <KpiCard title="Accepted" value={String(acceptedCount)} />
        <KpiCard
          title="Expiring within 2 days"
          value={String(expiringSoonCount)}
          desc={
            expiringSoonCount > 0 ? (
              <span className={`flex items-center gap-1 ${TONE_TEXT.warning}`}>
                <TriangleAlert className="size-3" /> Follow up before these
                lapse
              </span>
            ) : undefined
          }
        />
        <KpiCard title="Accept rate" value={`${conversionRate}%`} />
      </div>

      <Tabs
        value={status}
        onValueChange={(value) => setStatus(value as StatusFilter)}
      >
        <TabsList>
          {(
            [
              "OPEN",
              "DRAFT",
              "PENDING_APPROVAL",
              "SENT",
              "VIEWED",
              "ACCEPTED",
              "DECLINED",
              "EXPIRED",
              "SUPERSEDED",
              "CANCELLED",
              "ALL",
            ] as const
          ).map((key) => (
            <TabsTrigger key={key} value={key}>
              {key === "OPEN"
                ? "Open"
                : key === "ALL"
                  ? "All"
                  : STATUS_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search reference, contact, or package…"
        rowCount={filtered.length}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="size-8" />}
            title="No quotes found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Quote",
                  "Lead",
                  "Package / Group",
                  "Pax",
                  "Total",
                  "Valid Until",
                  "Status",
                  ...(canManage ? [""] : []),
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
              {filtered.map((q) => (
                <TableRow
                  key={q.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/quotes/${q.id}`)}
                >
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {q.reference}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{q.contactName}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {q.contactPhone}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {q.packageName}
                    {q.groupLabel && (
                      <p className="text-[11px] text-muted-foreground">
                        {q.groupLabel}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {q.adults + q.children}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {formatExactCurrency(q.totalLkr, q.currency)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    <span
                      className={
                        isExpiringSoon(q) ? TONE_TEXT.warning : undefined
                      }
                    >
                      {formatDate(q.validUntil)}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge
                      tone={STATUS_TONE[q.status]}
                      label={STATUS_LABELS[q.status]}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(q.status === "SENT" || q.status === "VIEWED") && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline_without_border"
                            onClick={() => decide(q, "ACCEPTED")}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => decide(q, "DECLINED")}
                          >
                            Decline
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>
    </div>
  );
}
