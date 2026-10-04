import { Badge } from "@/components/ui/badge";

import { CHANNEL_LABEL } from "@/lib/agent/whatsapp/analytics";
import type { AgentRunRow } from "./types";

const STATUS_VARIANT: Record<AgentRunRow["status"], "default" | "destructive" | "outline"> = {
  OK: "default",
  TOOL_ERROR: "destructive",
  MODEL_ERROR: "destructive",
  GUARDRAIL_BLOCKED: "outline",
  REFUSAL: "outline",
};

/** Read-only tail of `agent_runs` across every channel — the observability floor from §14 of the plan. */
export function AiAgentActivity({ runs }: { runs: AgentRunRow[] }) {
  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Recent activity</h3>
        <p className="text-xs text-muted-foreground">The last 15 model turns across every conversation, on any channel.</p>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No turns yet.</p>
      ) : (
        <div className="flex flex-col divide-y">
          {runs.map((run) => (
            <div key={run.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
                <Badge variant="outline">{CHANNEL_LABEL[run.channel] ?? run.channel}</Badge>
                <span className="text-muted-foreground truncate">
                  {new Date(run.created_at).toLocaleString()} · {run.effort ?? "—"} effort
                  {run.error ? ` · ${run.error}` : ""}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0">
                {(run.input_tokens ?? 0) + (run.output_tokens ?? 0)} tok · {run.latency_ms ?? 0}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
