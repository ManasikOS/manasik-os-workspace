import { cookies } from "next/headers";

import SectionHeading from "@/components/section-heading";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/tone-badge";
import { AGENT_CHANNELS, CHANNEL_LABEL, type AgentActivitySummary, type AgentChannel } from "@/lib/agent/whatsapp/analytics";
import type { AiMonthToDateUsage } from "@/lib/ai/usage-rollup";
import { getAgentActivitySummary } from "@/lib/data/ai-agent-analytics";
import { getAiMonthToDateUsage } from "@/lib/data/ai-usage";
import { getResponseTimeSummary, type ResponseTimeSummary } from "@/lib/data/response-time";
import { createClient } from "@/utils/supabase/server";

import { AiAgentAnalyticsSummary } from "./ai-agent-analytics-summary";
import { AiMonthlyCostCard } from "./ai-monthly-cost-card";
import { ResponseTimeCard } from "./response-time-card";

function AiAgentAnalyticsHeading() {
  return (
    <SectionHeading
      title="Assistant performance"
      description="The last 30 days of replies on WhatsApp, Messenger and Instagram: how quickly the assistant answers, how often a person had to step in, and what it costs."
    />
  );
}

/** Loading state — mirrors the layout of AiAgentAnalyticsSummary so the page doesn't jump. */
export function AiAgentAnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading assistant performance">
      <AiAgentAnalyticsHeading />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

/** Which channel the figures cover. Plain links, so the choice is in the address and survives a reload. */
function AiAgentChannelFilter({ active }: { active: AgentChannel | null }) {
  const options: Array<{ channel: AgentChannel | null; label: string }> = [{ channel: null, label: "All channels" }, ...AGENT_CHANNELS.map((channel) => ({ channel, label: CHANNEL_LABEL[channel] }))];
  return (
    <nav aria-label="Show figures for" className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.channel ? `/management/ai-agent?channel=${option.channel}` : "/management/ai-agent"}
          aria-current={option.channel === active ? "true" : undefined}
          className={buttonVariants({ variant: option.channel === active ? "secondary" : "outline", size: "sm" })}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

export async function AiAgentAnalyticsSection({ agencyId, channel = null }: { agencyId: string; channel?: AgentChannel | null }) {
  let summary: AgentActivitySummary | null = null;
  let responseTimes: ResponseTimeSummary | null = null;
  let monthlyUsage: AiMonthToDateUsage | null = null;

  try {
    const supabase = createClient(await cookies());
    monthlyUsage = await getAiMonthToDateUsage(supabase, agencyId).catch((error) => {
      console.error("Month-to-date AI cost failed to load:", error);
      return null;
    });
    [summary, responseTimes] = await Promise.all([
      getAgentActivitySummary(supabase, agencyId, channel),
      getResponseTimeSummary(supabase, agencyId).catch((error) => {
        console.error("Response time figures failed to load:", error);
        return null;
      }),
    ]);
  } catch (error) {
    console.error("AI agent analytics failed to load:", error);
  }

  return (
    <div className="flex flex-col gap-4">
      <AiAgentAnalyticsHeading />
      <AiAgentChannelFilter active={channel} />
      {summary ? (
        <AiAgentAnalyticsSummary summary={summary} />
      ) : (
        <Card className="p-4">
          <EmptyState
            title="We couldn't load the assistant's performance figures"
            description="This is usually temporary. Reload the page to try again — if it keeps happening, tell your administrator."
            action={
              <a href="/management/ai-agent" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Reload
              </a>
            }
          />
        </Card>
      )}
      {monthlyUsage && <AiMonthlyCostCard usage={monthlyUsage} />}
      {responseTimes && <ResponseTimeCard summary={responseTimes} />}
    </div>
  );
}
