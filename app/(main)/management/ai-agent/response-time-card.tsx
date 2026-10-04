import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/tone-badge";
import { CHANNEL_LABEL, isAgentChannel } from "@/lib/agent/whatsapp/analytics";
import type { ResponseTimeSummary } from "@/lib/data/response-time";

const RESPONDER_LABEL = { STAFF: "Your team", AI: "The assistant" } as const;

function channelName(channel: string): string {
  return isAgentChannel(channel) ? CHANNEL_LABEL[channel] : channel;
}

/** Whole minutes up to two hours, then hours and minutes — the way a person would say the wait. */
function formatWait(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return "Under 1 min";
  if (minutes <= 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function ResponseTimeCard({ summary }: { summary: ResponseTimeSummary }) {
  const waitingTotal = summary.waitingNow.reduce((total, entry) => total + entry.count, 0);

  return (
    <Card className="p-4 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">How fast customers get an answer</h3>
        <p className="text-xs text-muted-foreground">
          The last {summary.windowDays} days. The wait is counted from the first message a customer sent that nobody had answered yet, until the assistant or your team replied. Closed chats are left out.
        </p>
      </div>

      {summary.groups.length === 0 ? (
        <EmptyState title="No answered messages yet" description="Once customers write in and get a reply, the waiting times will appear here." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Answered by</TableHead>
              <TableHead className="text-right">Messages answered</TableHead>
              <TableHead className="text-right">Median wait</TableHead>
              <TableHead className="text-right">Slowest 10%</TableHead>
              <TableHead className="text-right">Answered within {summary.targetMinutes} minutes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.groups.map((group) => (
              <TableRow key={`${group.channel}-${group.responder}`}>
                <TableCell>{channelName(group.channel)}</TableCell>
                <TableCell>{RESPONDER_LABEL[group.responder]}</TableCell>
                <TableCell className="text-right">{group.answered}</TableCell>
                <TableCell className="text-right">{formatWait(group.medianMs)}</TableCell>
                <TableCell className="text-right">{formatWait(group.slowestTenthMs)}</TableCell>
                <TableCell className="text-right">{group.withinTargetPercent === null ? "—" : `${Math.round(group.withinTargetPercent)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="text-sm">
        <span className="font-medium">Waiting now: </span>
        {waitingTotal === 0 ? (
          <span className="text-muted-foreground">nobody — every customer has been answered.</span>
        ) : (
          <span>{summary.waitingNow.map((entry) => `${channelName(entry.channel)} ${entry.count}`).join(" · ")}</span>
        )}
      </div>

      {summary.truncated && (
        <p className="text-xs text-muted-foreground">There were too many messages to include them all, so the oldest days are left out of these figures.</p>
      )}
    </Card>
  );
}
