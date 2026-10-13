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
import { getCurrentDashboardCapabilities } from "@/lib/data/dashboard-capabilities";
import {
  loadDashboardData,
  loadInboxOwnerIntelligence,
} from "@/lib/data/dashboard-repository";
import { withTiming } from "@/lib/timing";
import { resolveDashboardPeriod } from "@/lib/data/dashboard";
import {
  resolveDashboardLayout,
  splitDashboardBlocks,
  type DashboardBannerBlockId,
  type DashboardGridPanelId,
} from "@/lib/data/dashboard-layout";
import { visibleBlocks } from "@/lib/access/dashboard-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { DashboardData } from "@/lib/types/dashboard";
import {
  InboxIntelligencePanel,
} from "./components/inbox-intelligence-panel";
import type { InboxOwnerIntelligence } from "@/lib/data/dashboard-repository";

/**
 * Dashboard — the landing route (`/` redirects here). A Server Component so
 * the KPIs, tasks and readiness figures below are all measured against one
 * clock and fetched once per render, same reasoning as
 * `app/(main)/documents/page.tsx`. See `lib/data/dashboard-repository.ts` for
 * how each section is assembled and role-gated, and
 * `lib/data/dashboard-layout.ts` for which blocks a role's page prefers and
 * in what order, and `lib/access/dashboard-access.ts` for which of those the
 * signed-in person may actually see
 * (docs/modules/dashboard-role-blocks-spec.md). Everything below the header
 * and the setup guide is rendered from that one resolved list.
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
const PANEL_SPAN: Record<DashboardGridPanelId, string> = {
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
  layout: DashboardGridPanelId[],
  data: DashboardData,
  role: StaffRole,
) {
  const panels: { id: DashboardGridPanelId; node: ReactNode }[] = [];

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

/** The full-width blocks above the grid — each a registry id, rendered in preset order. */
function renderDashboardBanner(
  id: DashboardBannerBlockId,
  data: DashboardData,
  role: StaffRole,
  name: string | null,
  inboxIntelligence: InboxOwnerIntelligence | null,
): ReactNode {
  switch (id) {
    case "ai-briefing":
      return (
        <AiBriefing
          key={id}
          staffName={name}
          role={role}
          status={data.statusLine}
          attentionRail={data.attentionRail}
          approvals={data.approvals}
          daily={data.copilotToday}
        />
      );
    case "kpis":
      return <DashboardMetrics key={id} kpis={data.kpis} />;
    case "inbox-owner":
      return inboxIntelligence ? (
        <InboxIntelligencePanel key={id} data={inboxIntelligence} />
      ) : null;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, staffId, agencyId, name } = await getCurrentStaffRole();
  const resolvedSearchParams = await searchParams;
  const period = resolveDashboardPeriod(resolvedSearchParams.period);

  // Base role + custom-role overrides; decides what is fetched, not just shown.
  const caps = await getCurrentDashboardCapabilities();

  // The role's preset pruned to what this person's capabilities allow — the
  // single list everything below renders from, and the input that decides
  // which extra loaders run.
  const blocks = visibleBlocks(resolveDashboardLayout(role), caps);
  const { banners, panels } = splitDashboardBlocks(blocks);

  const [data, inboxIntelligence] = await Promise.all([
    withTiming("dashboard.loadData", () =>
      loadDashboardData(role, staffId, agencyId, period, caps, blocks),
    ),
    banners.includes("inbox-owner")
      ? loadInboxOwnerIntelligence(role, agencyId)
      : Promise.resolve(null),
  ]);

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

      {banners.map((id) =>
        renderDashboardBanner(id, data, role, name, inboxIntelligence),
      )}

      {renderDashboardPanels(panels, data, role)}
    </div>
  );
}
