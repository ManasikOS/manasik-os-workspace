/**
 * Class 1 — INTERNAL_WRITE tools. See §8/D3 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Every one of
 * these stages into the turn's buffer (D8) rather than writing the
 * database — nothing here is a mutator call. `run.ts` commits the buffer,
 * through the same `*InStore` mutators a human's click uses, only after
 * `submit_review` fires and guardrails (§11) pass.
 *
 * `update_readiness_item_meta`'s input schema has no `status` field at
 * all — not merely validated away. An item with a non-null `auto_source`
 * refuses a manual status change (`updateReadinessItemInStore`, F9); the
 * agent's only route to moving one is a Class-2 proposal against the row
 * it actually follows.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";
import type { StagedBuffer } from "@/lib/agent/departure-ops/buffer";

/**
 * F10: an agent-created task with no resolvable owner is a task nobody
 * sees. Resolves against the agency's active staff by name — a
 * case-insensitive exact match, since "close enough" name matching is how
 * a task ends up assigned to the wrong person.
 */
async function resolveOwner(
  ctx: DepartureOpsContext,
  ownerName: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await ctx.db
    .from("staff_profiles")
    .select("id, full_name")
    .eq("agency_id", ctx.agencyId)
    .eq("status", "ACTIVE")
    .ilike("full_name", ownerName.trim())
    .maybeSingle();

  if (!data) return null;
  const row = data as { id: string; full_name: string };
  return { id: row.id, name: row.full_name };
}

export function createInternalWriteTools(
  ctx: DepartureOpsContext,
  buffer: StagedBuffer,
  nextStagedId: (kind: string) => string,
) {
  const createTask = betaTool({
    name: "create_task",
    description:
      "Stages a new operational task against this group, addressed to a named member of staff. The " +
      "owner must be an existing, active staff member on this agency — resolve the name from the " +
      "group's owners in the snapshot (operations/visa/finance/guide/coordinator) rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        description: { type: "string", maxLength: 1000 },
        ownerName: { type: "string", minLength: 1 },
        dueAt: { type: "string", description: "ISO date or datetime." },
        category: { type: "string", enum: ["OPERATIONS", "VISA", "FINANCE", "GUIDE", "MARKETING", "OTHER"] },
        linkedReadinessItemId: { type: "string" },
      },
      required: ["title", "ownerName", "dueAt", "category"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const owner = await resolveOwner(ctx, args.ownerName);
      if (!owner) {
        return JSON.stringify({
          error: `"${args.ownerName}" does not match an active staff member on this agency. Use one of the group's named owners.`,
        });
      }

      const stagedId = nextStagedId("task");
      buffer.tasks.push({
        stagedId,
        input: {
          title: args.title,
          description: args.description ?? null,
          ownerName: owner.name,
          ownerId: owner.id,
          dueAt: args.dueAt,
          category: args.category,
          linkedReadinessItemId: args.linkedReadinessItemId ?? null,
        },
      });
      return JSON.stringify({ staged: true, stagedId, ownerResolved: owner.name });
    },
  });

  const reassignTask = betaTool({
    name: "reassign_task",
    description: "Stages reassigning an existing open task to a different named, active staff member.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, ownerName: { type: "string", minLength: 1 } },
      required: ["taskId", "ownerName"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const owner = await resolveOwner(ctx, args.ownerName);
      if (!owner) {
        return JSON.stringify({ error: `"${args.ownerName}" does not match an active staff member on this agency.` });
      }
      const stagedId = nextStagedId("task-reassign");
      buffer.taskReassignments.push({ stagedId, taskId: args.taskId, ownerName: owner.name, ownerId: owner.id });
      return JSON.stringify({ staged: true, stagedId });
    },
  });

  const updateTaskStatus = betaTool({
    name: "update_task_status",
    description:
      "Stages moving an existing task between OPEN and IN_PROGRESS, or marking it COMPLETE. Only use " +
      "COMPLETE when you have direct evidence the work is actually done, not because it looks stale.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, status: { type: "string", enum: ["IN_PROGRESS", "COMPLETE"] } },
      required: ["taskId", "status"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const stagedId = nextStagedId("task-status");
      buffer.taskStatusUpdates.push({ stagedId, taskId: args.taskId, status: args.status });
      return JSON.stringify({ staged: true, stagedId });
    },
  });

  const updateReadinessItemMeta = betaTool({
    name: "update_readiness_item_meta",
    description:
      "Stages setting a readiness item's owner, due date, notes, or evidence URL. This never changes " +
      "an item's status — a derived item's status follows the row it tracks (see its movedBy hint), and " +
      "a manual item's status is a Class-2 decision. Use this to assign ownership and set a realistic due " +
      "date, not to mark anything complete.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        assignedToName: { type: "string" },
        dueAt: { type: "string" },
        evidenceUrl: { type: "string" },
        notes: { type: "string", maxLength: 1000 },
      },
      required: ["itemId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const stagedId = nextStagedId("readiness-meta");
      buffer.readinessItemUpdates.push({
        stagedId,
        input: {
          id: args.itemId,
          assignedToName: args.assignedToName,
          dueAt: args.dueAt,
          evidenceUrl: args.evidenceUrl,
          notes: args.notes,
        },
      });
      return JSON.stringify({ staged: true, stagedId });
    },
  });

  const recordFinding = betaTool({
    name: "record_finding",
    description:
      "Stages a risk-register finding — what you concluded, and why. A CRITICAL or WARNING finding must " +
      "name the blocker id or readiness item id from the snapshot that corroborates it; a finding that " +
      "restates the checklist rather than adding a conclusion will be dropped before it reaches the " +
      "register. Use INFO for something worth noting with nothing in the data to point at.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["CRITICAL", "WARNING", "INFO"] },
        category: {
          type: "string",
          enum: ["FLIGHT", "HOTEL", "TRANSPORT", "VISA", "DOCUMENTS", "ROOMING", "PAYMENTS", "GUIDE", "MANIFEST"],
        },
        headline: { type: "string", maxLength: 120 },
        detail: { type: "string", maxLength: 800 },
        corroboratingBlockerId: { type: "string" },
        linkedTaskStagedId: { type: "string", description: "A stagedId returned by create_task earlier this turn." },
        linkedProposalStagedId: { type: "string", description: "A stagedId returned by propose_action earlier this turn." },
      },
      required: ["severity", "category", "headline", "detail"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const stagedId = nextStagedId("finding");
      buffer.findings.push({
        stagedId,
        severity: args.severity,
        category: args.category,
        headline: args.headline,
        detail: args.detail,
        corroboratingBlockerId: args.corroboratingBlockerId ?? null,
        linkedTaskStagedId: args.linkedTaskStagedId ?? null,
        linkedProposalStagedId: args.linkedProposalStagedId ?? null,
      });
      return JSON.stringify({ staged: true, stagedId });
    },
  });

  return [createTask, reassignTask, updateTaskStatus, updateReadinessItemMeta, recordFinding];
}
