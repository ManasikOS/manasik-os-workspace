import type { GateCheckResult, GateStatus } from "./types";

export interface GateSummary {
  /** 0: every check passed. 2: nothing is broken but something is still pending. 1: at least one check failed. */
  exitCode: 0 | 1 | 2;
  counts: Record<GateStatus, number>;
  verdict: "PASS" | "PENDING" | "FAIL";
}

export function summarize(results: GateCheckResult[]): GateSummary {
  const counts: Record<GateStatus, number> = { PASS: 0, FAIL: 0, PENDING: 0 };
  for (const result of results) counts[result.status] += 1;
  if (counts.FAIL > 0) return { exitCode: 1, counts, verdict: "FAIL" };
  if (counts.PENDING > 0) return { exitCode: 2, counts, verdict: "PENDING" };
  return { exitCode: 0, counts, verdict: "PASS" };
}

const MARK: Record<GateStatus, string> = { PASS: "PASS", FAIL: "FAIL", PENDING: "PENDING" };

/** The same report for a terminal, a workflow summary and the pinned issue. Names and counts only. */
export function renderMarkdown(results: GateCheckResult[], meta: { target: string; environment: string; at: Date }): string {
  const summary = summarize(results);
  const lines = [
    `## Production gate: ${summary.verdict}`,
    "",
    `Target: ${meta.target} (expected environment: ${meta.environment}) at ${meta.at.toISOString()}`,
    `${summary.counts.PASS} passed, ${summary.counts.PENDING} pending, ${summary.counts.FAIL} failed.`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...results.map((result) => `| ${result.id} ${result.title} | ${MARK[result.status]} | ${result.detail.replace(/\|/g, "/")} |`),
  ];
  const withItems = results.filter((result) => result.items && result.items.length > 0 && result.status !== "PASS");
  for (const result of withItems) {
    lines.push("", `### ${result.id} ${result.title}`, ...result.items!.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}
