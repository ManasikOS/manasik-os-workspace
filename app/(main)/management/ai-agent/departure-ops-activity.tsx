import { Badge } from "@/components/ui/badge";

import type { DepartureOpsRunRow } from "./types";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
  OK: "default",
  NOOP: "secondary",
  TOOL_ERROR: "destructive",
  MODEL_ERROR: "destructive",
  REFUSAL: "outline",
  INCOMPLETE: "outline",
};

/** Read-only tail of `departure_ops_runs` — the same observability floor AiAgentActivity gives the WhatsApp agent, for this one. */
export function DepartureOpsActivity({ runs }: { runs: DepartureOpsRunRow[] }) {
  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Recent activity</h3>
        <p className="text-xs text-muted-foreground">The last 15 reviews across every departure group.</p>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet.</p>
      ) : (
        <div className="flex flex-col divide-y">
          {runs.map((run) => (
            <div key={run.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{run.status}</Badge>
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
