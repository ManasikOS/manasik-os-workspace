"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { Route, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/app/(main)/departure-groups/components/status-badges";
import { formatDate } from "@/app/(main)/departure-groups/utils";
import type { CrossGroupItinerarySummary } from "@/lib/data/itinerary-repository";
import { TONE_TEXT, type Tone } from "@/lib/ui/tone";

const STATUS_LABELS: Record<CrossGroupItinerarySummary["status"], string> = {
  NOT_STARTED: "Not Started",
  DRAFT: "Draft",
  PUBLISHED: "Published",
};

const STATUS_TONE: Record<CrossGroupItinerarySummary["status"], Tone> = {
  NOT_STARTED: "neutral",
  DRAFT: "warning",
  PUBLISHED: "success",
};

type Filter = "ALL" | "UPCOMING" | CrossGroupItinerarySummary["status"] | "UNCONFIRMED";

interface ItineraryListViewProps {
  summaries: CrossGroupItinerarySummary[];
  canManage: boolean;
}

export default function ItineraryListView({ summaries, canManage }: ItineraryListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("UPCOMING");
  const [now] = useState(() => Date.now());

  const isUpcoming = (s: CrossGroupItinerarySummary) =>
    s.groupStatus !== "CANCELLED" && s.groupStatus !== "COMPLETED" && s.groupStatus !== "CLOSED" &&
    Date.parse(s.departureDate) >= now;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return summaries.filter((s) => {
      if (filter === "UPCOMING" && !isUpcoming(s)) return false;
      if (filter === "UNCONFIRMED" && s.unconfirmedCount === 0) return false;
      if (filter !== "ALL" && filter !== "UPCOMING" && filter !== "UNCONFIRMED" && s.status !== filter) return false;
      if (!needle) return true;
      return [s.groupName, s.groupCode].join(" ").toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries, search, filter, now]);

  const upcoming = summaries.filter(isUpcoming);
  const notStartedCount = upcoming.filter((s) => s.status === "NOT_STARTED").length;
  const publishedCount = upcoming.filter((s) => s.status === "PUBLISHED").length;
  const unconfirmedTotal = upcoming.reduce((sum, s) => sum + s.unconfirmedCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Itinerary & Services"
        breadcrumb={[{ title: "Operations", link: "/operations" }, { title: "Itinerary & Services", link: "/itinerary-services" }]}
        subTitle="Each departure group's live day-by-day plan. Build and publish one from its own itinerary builder."
        action={null}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Upcoming departures" value={String(upcoming.length)} />
        <KpiCard title="Not started" value={String(notStartedCount)} />
        <KpiCard title="Published" value={String(publishedCount)} />
        <KpiCard
          title="Unconfirmed events"
          value={String(unconfirmedTotal)}
          desc={
            unconfirmedTotal > 0 ? (
              <span className={`flex items-center gap-1 ${TONE_TEXT.warning}`}>
                <TriangleAlert className="size-3" /> Missing supplier or guide confirmation
              </span>
            ) : undefined
          }
        />
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList>
          {(["UPCOMING", "NOT_STARTED", "DRAFT", "PUBLISHED", "UNCONFIRMED", "ALL"] as const).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
            >
              {key === "ALL"
                ? "All"
                : key === "UPCOMING"
                  ? "Upcoming"
                  : key === "UNCONFIRMED"
                    ? "Has Unconfirmed"
                    : STATUS_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface search={search} onSearchChange={setSearch} searchPlaceholder="Search departure group…" rowCount={filtered.length}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Route className="size-8" />}
            title="No departures found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Group", "Departs", "Days", "Events", "Unconfirmed", "Status"].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((s) => (
                <TableRow
                  key={s.departureGroupId}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/itinerary-services/${s.departureGroupId}`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{s.groupName}</p>
                    <p className="text-[11px] text-muted-foreground">{s.groupCode}</p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {formatDate(s.departureDate)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">{s.dayCount}</TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">{s.eventCount}</TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number">
                    <span className={s.unconfirmedCount > 0 ? TONE_TEXT.warning : "text-muted-foreground"}>
                      {s.unconfirmedCount}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge tone={STATUS_TONE[s.status]} label={STATUS_LABELS[s.status]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          Your role can view itinerary status but not build or publish one.
        </p>
      )}
    </div>
  );
}
