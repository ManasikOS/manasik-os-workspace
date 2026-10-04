/**
 * Assembles one turn's tool set. Every tool a Departure Operations Agent
 * turn can call, and nothing else — there is no `confirm_hotel`, no
 * `send_message`, no `mark_ready` (D3). The absence is the guardrail; see
 * §8 of docs/modules/departure-operations-agent-implementation-plan.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- every tool has a genuinely different input type; BetaRunnableTool<any> is the SDK's own shape for a heterogeneous tool array */
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import { wrapWithTelemetryAndRedaction, type ToolTelemetry } from "@/lib/agent/kernel/telemetry";
import { createStagedIdGenerator, newStagedBuffer, type StagedBuffer } from "@/lib/agent/departure-ops/buffer";
import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";
import { createInternalWriteTools } from "@/lib/agent/departure-ops/tools/internal";
import { createProposeTool } from "@/lib/agent/departure-ops/tools/propose";
import { createReadTools } from "@/lib/agent/departure-ops/tools/read";
import { createSubmitTool } from "@/lib/agent/departure-ops/tools/submit";

export function buildDepartureOpsToolSet(
  ctx: DepartureOpsContext,
  telemetry: ToolTelemetry,
): { tools: BetaRunnableTool<any>[]; buffer: StagedBuffer } {
  const buffer = newStagedBuffer();
  const nextStagedId = createStagedIdGenerator();

  const tools: BetaRunnableTool<any>[] = [
    ...createReadTools(ctx),
    ...createInternalWriteTools(ctx, buffer, nextStagedId),
    ...createProposeTool(buffer, nextStagedId),
    ...createSubmitTool(buffer),
  ];

  return { tools: tools.map((tool) => wrapWithTelemetryAndRedaction(tool, telemetry)), buffer };
}
