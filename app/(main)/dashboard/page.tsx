import type { ReactNode } from "react";

import PageHeader from "@/components/page-header";
import DashboardMetrics from "./components/metrics";
import MyDay from "./components/my-day";
import UpcomingDepartures from "./components/upcoming-departures";
import AttentionRail from "./components/attention-rail";
import AgentApprovals from "./components/agent-approvals";
import RevenueTrendCard from "./components/revenue-trend";
import ReceivablesAgingCard from "./components/receivables-aging";
import ReadinessHeatmap from "./components/readiness-heatmap";
import SeatFillPace from "./components/seat-fill-pace";
import Pipeline from "./components/pipeline";
import TeamPerformance from "./components/team-performance";
import CollectionsAttention from "./components/collections-attention";
import RecentActivity from "./components/recent-activity";
import AiBriefing from "./components/ai-briefing";
import SetupGuideCard from "./components/setup-guide-card";
import PeriodSelector from "./components/period-selector";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  loadDashboardData,
  loadInboxOwnerIntelligence,
} from "@/lib/data/dashboard-repository";
import { withTiming } from "@/lib/timing";
import { resolveDashboardPeriod } from "@/lib/data/dashboard";
import {
  resolveDashboardLayout,
  type DashboardPanelId,
} from "@/lib/data/dashboard-layout";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { DashboardData } from "@/lib/types/dashboard";
import { InboxIntelligencePanel } from "./components/inbox-intelligence-panel";

/**
 * Dashboard — the landing route (`/` redirects here). A Server Component so
 * the KPIs, tasks and readiness figures below are all measured against one
 * clock and fetched once per render, same reasoning as
 * `app/(main)/documents/page.tsx`. See `lib/data/dashboard-repository.ts` for
 * how each section is assembled and role-gated, and
 * `lib/data/dashboard-layout.ts` for which panels a role sees below the
 * status line and KPI row, and in what order
 * (docs/modules/dashboard-module-implementation-plan.md §4.2).
 */
export const dynamic = "force-dynamic";

/**
 * Column span (of 12, at `lg:`) each panel takes in the dashboard grid.
 * "My Day" / "Attention Rail" / "Approvals" are narrow list-style cards that
 * read well three-across; "Upcoming Departures" carries dense per-group
 * content and stays full-width. Seat Fill Pace is the headline forward-
 * looking chart (§5.6) so it gets the wide 7-of-12 hero slot; Revenue Trend
 * and Receivables Aging stack in the remaining 5 alongside it, mirroring how
 * the two used to share one tabbed "Business Health" card but are now both
 * visible without a click. `grid-flow-row-dense` (set on the container)
 * backfills any gap a role's shorter panel list would otherwise leave.
 */
const PANEL_SPAN: Record<DashboardPanelId, string> = {
  pipeline: "lg:col-span-6",
  "my-day": "lg:col-span-6",
  "attention-rail": "lg:col-span-5",
  approvals: "lg:col-span-4",
  "upcoming-departures": "lg:col-span-12",
  "seat-fill-pace": "lg:col-span-7",
  "revenue-trend": "lg:col-span-9",
  "readiness-heatmap": "lg:col-span-4",
  "team-performance": "lg:col-span-4",
  collections: "lg:col-span-6",
  "recent-activity": "lg:col-span-6",
};

function renderDashboardPanels(
  layout: DashboardPanelId[],
  data: DashboardData,
  role: StaffRole,
) {
  const panels: { id: DashboardPanelId; node: ReactNode }[] = [];

  for (const id of layout) {
    switch (id) {
      case "pipeline":
        if (data.pipeline)
          panels.push({ id, node: <Pipeline data={data.pipeline} /> });
        break;
      case "my-day":
        panels.push({ id, node: <MyDay data={data.myDay} /> });
        break;
      case "upcoming-departures":
        panels.push({
          id,
          node: <UpcomingDepartures groups={data.departureGroups} />,
        });
        break;
      case "attention-rail":
        panels.push({ id, node: <AttentionRail rows={data.attentionRail} /> });
        break;
      case "approvals":
        if (data.approvals) {
          panels.push({
            id,
            node: (
              <AgentApprovals
                totalCount={data.approvals.totalCount}
                top={data.approvals.top}
                role={role}
                daily={data.copilotToday}
              />
            ),
          });
        }
        break;
      case "revenue-trend":
        if (data.businessHealth)
          panels.push({
            id,
            node: (
              <div className="flex flex-col gap-6">
                <RevenueTrendCard data={data.businessHealth} />
                <ReceivablesAgingCard data={data.businessHealth} />
              </div>
            ),
          });
        break;
      case "readiness-heatmap":
        panels.push({
          id,
          node: <ReadinessHeatmap groups={data.departureGroups} />,
        });
        break;
      case "seat-fill-pace":
        panels.push({ id, node: <SeatFillPace points={data.seatPace} /> });
        break;

      case "team-performance":
        if (data.teamPerformance)
          panels.push({
            id,
            node: <TeamPerformance rows={data.teamPerformance} />,
          });
        break;
      case "collections":
        if (data.collections)
          panels.push({
            id,
            node: <CollectionsAttention collections={data.collections} />,
          });
        break;
      case "recent-activity":
        panels.push({
          id,
          node: <RecentActivity activities={data.recentActivities} />,
        });
        break;
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-flow-row-dense gap-6">
      {panels.map(({ id, node }) => (
        <div key={id} className={PANEL_SPAN[id]}>
          {node}
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, staffId, agencyId, name } = await getCurrentStaffRole();
  const resolvedSearchParams = await searchParams;
  const period = resolveDashboardPeriod(resolvedSearchParams.period);

  const [data, inboxIntelligence] = await Promise.all([
    withTiming("dashboard.loadData", () =>
      loadDashboardData(role, staffId, agencyId, period),
    ),
    loadInboxOwnerIntelligence(role, agencyId),
  ]);
  const layout = resolveDashboardLayout(role);

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto pb-10">
      <PageHeader
        title="Dashboard"
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Dashboard", link: "/dashboard" },
        ]}
        action={<PeriodSelector period={period} />}
      />

      <SetupGuideCard />

      <AiBriefing
        staffName={name}
        role={role}
        status={data.statusLine}
        attentionRail={data.attentionRail}
        approvals={data.approvals}
        daily={data.copilotToday}
      />

      <DashboardMetrics kpis={data.kpis} />

      {inboxIntelligence && <InboxIntelligencePanel data={inboxIntelligence} />}

      {renderDashboardPanels(layout, data, role)}
    </div>
  );
}
