"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  CHANNEL_LABEL,
  type AgentActivitySummary,
  type AgentChannelSummary,
  type AgentToolReliability,
} from "@/lib/agent/whatsapp/analytics";
import { TONE_BADGE_BORDER, TONE_CLASS, type Tone } from "@/lib/ui/tone";

const REPLIES_CHART_CONFIG = {
  replies: { label: "Replies", color: "var(--primary)" },
} satisfies ChartConfig;

const COST_CHART_CONFIG = {
  costUsd: { label: "Cost (USD)", color: "var(--primary)" },
} satisfies ChartConfig;

const REPLY_OUTCOME_LABELS: Record<string, string> = {
  OK: "Replied normally",
  GUARDRAIL_BLOCKED: "Stopped by a safety check",
  REFUSAL: "Declined by the model",
  TOOL_ERROR: "A tool failed",
  MODEL_ERROR: "Model error",
};

const TOOL_LABELS: Record<string, string> = {
  get_upcoming_departures: "Look up upcoming departures",
  search_departures: "Search departures",
  get_departure_details: "Read departure details",
  check_departure_availability: "Check seat availability",
  find_or_create_lead: "Save an enquiry as a lead",
  update_lead: "Update lead details",
  add_lead_note: "Add a note to a lead",
  start_booking: "Start a booking",
  record_traveller: "Record traveller details",
  review_booking: "Summarise a booking for review",
  confirm_and_hold_booking: "Hold seats for a customer",
  get_booking_status: "Check booking status",
  search_knowledge_base: "Look up a policy or guide",
  transfer_to_staff: "Pass the chat to a person",
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)} s`
    : `${Math.round(milliseconds)} ms`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

/**
 * Meta requires an automated Messenger or Instagram account to answer within 30 seconds; WhatsApp has no such
 * rule, so its cell says so instead of showing a figure that would read as a pass or a fail.
 */
function responseLimitCell(row: AgentChannelSummary) {
  if (row.channel === "WHATSAPP")
    return <span className="text-muted-foreground">Not required</span>;
  if (row.overResponseLimitPercent === null)
    return <span className="text-muted-foreground">—</span>;
  const tone: Tone =
    row.overResponseLimitPercent === 0
      ? "success"
      : row.overResponseLimitPercent >= 5
        ? "danger"
        : "warning";
  return (
    <ToneBadge
      tone={tone}
      label={
        row.overResponseLimitPercent === 0
          ? "None over 30 s"
          : `${Math.round(row.overResponseLimitPercent)}% over 30 s`
      }
    />
  );
}

/** The three channels side by side — always across every channel, so it stays a comparison whichever one is filtered above. */
function AiAgentChannelBreakdown({ rows }: { rows: AgentChannelSummary[] }) {
  return (
    <Card className="p-4 gap-3">
      <div>
        <p className="text-sm font-medium">How each channel is doing</p>
        <p className="text-xs text-muted-foreground">
          The same assistant, measured on each channel. Messenger and Instagram
          must answer within 30 seconds to keep Meta&apos;s automated-assistant
          status; this counts the assistant&apos;s own thinking time, so allow a
          little more for delivery.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Conversations</TableHead>
            <TableHead className="text-right">Replies</TableHead>
            <TableHead className="text-right">
              Handled without a person
            </TableHead>
            <TableHead className="text-right">Typical reply time</TableHead>
            <TableHead className="text-right">Slowest 1 in 20</TableHead>
            <TableHead>Meta&apos;s 30-second rule</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.channel}>
              <TableCell className="font-medium">
                {CHANNEL_LABEL[row.channel]}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.conversationCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.replyCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(row.handledWithoutPersonPercent)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(row.typicalLatencyMs)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(row.slowestTwentiethLatencyMs)}
              </TableCell>
              <TableCell>{responseLimitCell(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function toolFailureTone(tool: AgentToolReliability): Tone {
  if (tool.failures === 0) return "success";
  return tool.failurePercent >= 25 ? "danger" : "warning";
}

function AiAgentPerformanceTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4 gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function AiAgentDailyBarChart({
  title,
  data,
  dataKey,
  config,
  valueFormatter,
}: {
  title: string;
  data: AgentActivitySummary["daily"];
  dataKey: "replies" | "costUsd";
  config: ChartConfig;
  valueFormatter?: (value: number) => string;
}) {
  return (
    <Card className="p-4 gap-3">
      <p className="text-sm font-medium">{title}</p>
      <ChartContainer config={config} className="h-48 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickFormatter={(day: string) => day.slice(5)}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={40}
            allowDecimals={false}
            tickFormatter={valueFormatter}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={
                  valueFormatter
                    ? (value) => valueFormatter(Number(value))
                    : undefined
                }
              />
            }
          />
          <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={4} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}

/** Read-only "Assistant performance" figures for Manasik Copilot — see TASK-002. */
export function AiAgentAnalyticsSummary({
  summary,
}: {
  summary: AgentActivitySummary;
}) {
  const scope = summary.channel ? CHANNEL_LABEL[summary.channel] : null;
  if (summary.replyCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        {summary.byChannel.length > 0 && (
          <AiAgentChannelBreakdown rows={summary.byChannel} />
        )}
        <Card className="p-4">
          <EmptyState
            title={
              scope
                ? `The assistant hasn't replied on ${scope} in the last 30 days`
                : "The assistant hasn't replied to anyone in the last 30 days"
            }
            description={
              scope
                ? `Once it answers a conversation on ${scope}, its reply speed, running cost and tool reliability will show up here. Check that ${scope} is connected and its assistant switch is on under Settings → Integrations, and that the assistant is switched on above.`
                : "Once it answers a conversation, its reply speed, running cost and tool reliability will show up here. Check that the assistant is switched on above and that a channel is connected under Settings → Integrations."
            }
          />
        </Card>
      </div>
    );
  }

  const outcomes = Object.entries(summary.statusCounts).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex flex-col gap-4">
      {summary.truncated && (
        <div
          className={`rounded-lg border p-3 text-xs ${TONE_CLASS.warning} ${TONE_BADGE_BORDER.warning}`}
        >
          This period has more activity than can be shown at once, so the
          figures below are a lower estimate.
        </div>
      )}
      {summary.unpricedRunCount > 0 && (
        <div
          className={`rounded-lg border p-3 text-xs ${TONE_CLASS.warning} ${TONE_BADGE_BORDER.warning}`}
        >
          {summary.unpricedRunCount}{" "}
          {summary.unpricedRunCount === 1 ? "reply was" : "replies were"} made
          with a model that has no price on file (
          {summary.unpricedModels.join(", ")}), so the cost below is missing{" "}
          {summary.unpricedRunCount === 1 ? "it" : "them"}.
        </div>
      )}

      {summary.byChannel.length > 0 && (
        <AiAgentChannelBreakdown rows={summary.byChannel} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AiAgentPerformanceTile
          label="Conversations"
          value={String(summary.conversationCount)}
          detail={`${summary.replyCount} ${summary.replyCount === 1 ? "reply" : "replies"} sent by the assistant`}
        />
        <AiAgentPerformanceTile
          label="Handled without a person"
          value={formatPercent(summary.handledWithoutPersonPercent)}
          detail={`${summary.handledWithoutPersonCount} of ${summary.conversationCount} conversations. ${summary.passedToPersonCount} ${summary.passedToPersonCount === 1 ? "is" : "are"} with a person now`}
        />
        <AiAgentPerformanceTile
          label="Typical reply time"
          value={formatDuration(summary.typicalLatencyMs)}
          detail={`Slowest 1 in 20 replies took ${formatDuration(summary.slowestTwentiethLatencyMs)}`}
        />
        <AiAgentPerformanceTile
          label="Assistant cost"
          value={formatUsd(summary.costUsd)}
          detail="AI usage only. WhatsApp fees are on the Billing screen; Messenger and Instagram messages are free"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AiAgentDailyBarChart
          title="Replies per day"
          data={summary.daily}
          dataKey="replies"
          config={REPLIES_CHART_CONFIG}
        />
        <AiAgentDailyBarChart
          title="Assistant cost per day"
          data={summary.daily}
          dataKey="costUsd"
          config={COST_CHART_CONFIG}
          valueFormatter={formatUsd}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AiAgentPerformanceTile
          label="Prompt reuse"
          value={formatPercent(summary.cacheReusePercent)}
          detail="Higher is cheaper and faster. Near 0% means something is changing the assistant's instructions on every reply"
        />
        <AiAgentPerformanceTile
          label="Enquiries saved as leads"
          value={String(summary.leadsCaptured)}
          detail={
            scope
              ? `New leads from ${scope} in this period`
              : "New leads from WhatsApp, Messenger and Instagram in this period"
          }
        />
        <AiAgentPerformanceTile
          label="Bookings held for customers"
          value={String(summary.bookingsHeld)}
          detail="Seats the assistant held after the customer confirmed"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-4 gap-3 xl:col-span-2">
          <div>
            <p className="text-sm font-medium">How reliable each tool is</p>
            <p className="text-xs text-muted-foreground">
              Tools are how the assistant looks things up and saves things. A
              tool that often fails is the first place to look when replies feel
              wrong. This covers every channel.
            </p>
          </div>
          {summary.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The assistant hasn&apos;t used any tools yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead className="text-right">Times used</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.tools.map((tool) => (
                  <TableRow key={tool.toolName}>
                    <TableCell>
                      <p className="text-sm">
                        {TOOL_LABELS[tool.toolName] ?? tool.toolName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {tool.toolName}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tool.calls}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tool.failures}
                    </TableCell>
                    <TableCell>
                      <ToneBadge
                        tone={toolFailureTone(tool)}
                        label={
                          tool.failures === 0
                            ? "No failures"
                            : `${Math.round(tool.failurePercent)}% failed`
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-4 gap-3">
          <p className="text-sm font-medium">How replies ended</p>
          <div className="flex flex-col gap-2">
            {outcomes.map(([status, count]) => (
              <div
                key={status}
                className="flex items-center justify-between text-sm"
              >
                <span>{REPLY_OUTCOME_LABELS[status] ?? status}</span>
                <span className="tabular-nums text-muted-foreground">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
