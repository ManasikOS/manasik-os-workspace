/**
 * The terminal tool — D8. Calling this is what commits the staged buffer;
 * a turn that ends without calling it persists nothing but telemetry (see
 * run.ts). It is not merely a "done" signal — it is the commit trigger.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { StagedBuffer } from "@/lib/agent/departure-ops/buffer";

export function createSubmitTool(buffer: StagedBuffer) {
  const submitReview = betaTool({
    name: "submit_review",
    description:
      "Ends this review and commits everything you staged — tasks, readiness updates, findings, and " +
      "proposals. Call this exactly once, as your final action, after you have staged everything you " +
      "concluded this group needs. Nothing you staged is saved until you call this.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", maxLength: 400, description: "One or two sentences a human skimming the run log would want." },
        confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        tierAssessment: {
          type: "string",
          maxLength: 200,
          description: "One sentence on whether this group's escalation tier still fits its actual state.",
        },
      },
      required: ["summary", "confidence", "tierAssessment"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      buffer.submitted = { summary: args.summary, confidence: args.confidence, tierAssessment: args.tierAssessment };
      return JSON.stringify({
        ok: true,
        staged: {
          tasks: buffer.tasks.length,
          taskReassignments: buffer.taskReassignments.length,
          taskStatusUpdates: buffer.taskStatusUpdates.length,
          readinessItemUpdates: buffer.readinessItemUpdates.length,
          findings: buffer.findings.length,
          proposals: buffer.proposals.length,
        },
      });
    },
  });

  return [submitReview];
}
