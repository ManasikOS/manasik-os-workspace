/**
 * Class-2 proposal kind for the document/visa AI review pipeline
 * (`analyseGroupPilgrimTicket` / `analyseGroupPilgrimVisa` in
 * lib/data/departure-groups.ts). That pipeline is explicitly assistive
 * only — it flags a name mismatch, a PNR mismatch, a missing page, but
 * never rewrites `visa_status` or `ticket_ai_status` itself, and the
 * agent's own prompt (lib/agent/departure-ops/prompt.ts) says outright it
 * has "no tool for... a passport, visa or document record" and should
 * "create a task for a human and say why" instead.
 *
 * This kind is that "why," made concrete and reviewable: the Copilot drafts
 * the actual rework-request wording a human would otherwise have to write
 * from scratch after reading the AI finding, and stages it as one task —
 * never a message it sends itself, never a status it flips. `execute()`
 * calls the exact same `createGroupTaskInStore` a human's own "New Task"
 * button calls (mirrors §9.1's pattern for every other kind here); the only
 * thing a human is actually approving is the drafted wording.
 *
 * `requiredCapability` is deliberately `manageDocumentsAndVisa`, not the
 * looser `manageTasks` that ordinary task creation sits behind — approving
 * this means signing off on customer-facing document/visa language, so it
 * takes the stricter gate (ADMIN/OPERATIONS/VISA), same reasoning as
 * `BOOKING_SEND_REMINDER`'s HIGH risk despite neither kind transmitting
 * anything itself.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import { createGroupTaskInStore } from "@/lib/data/departure-groups-tasks";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

const Schema = z.object({
  pilgrimId: z.string().uuid(),
  pilgrimName: z.string().min(1),
  documentType: z.enum(["TICKET", "VISA"]),
  /** The AI finding in plain language — e.g. "Passenger name on the ticket doesn't match the pilgrim record." */
  issueSummary: z.string().min(1).max(300),
  /** The actual rework request a human reviews and sends — never sent by this executor itself, see file header. */
  draftMessage: z.string().min(1).max(2000),
  taskTitle: z.string().min(1).max(120),
  ownerName: z.string().min(1),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.string(),
});
type Payload = z.infer<typeof Schema>;

export const documentReworkRequestExecutor: LegacyProposalExecutor<Payload> = {
  kind: "DOCUMENT_REWORK_REQUEST_DRAFTED",
  schema: Schema,
  requiredCapability: "manageDocumentsAndVisa",
  risk: "HIGH",
  ttlHours: 72,
  // One open proposal per (pilgrim, document type) — a second AI pass over
  // the same still-unresolved finding shouldn't queue a duplicate ask.
  fingerprint: (p) => `DOCUMENT_REWORK_REQUEST_DRAFTED:${p.pilgrimId}:${p.documentType}`,
  // OpsSnapshot carries no per-pilgrim AI-issue detail (PII/scope posture —
  // same reasoning as reminders.ts's own dependencySnapshot). The coarse
  // group-wide counts are the closest available signal that something
  // material shifted; createGroupTaskInStore's own validation is the live
  // check at execute time.
  dependencySnapshot: (_p, snapshot) => ({
    visaCounts: snapshot.travellers.visaCounts,
    documentsOutstanding: snapshot.travellers.documentsOutstanding,
  }),
  describe: (p) => ({
    humanDiff: [
      { field: "task", from: null, to: p.taskTitle },
      { field: "assigned to", from: null, to: p.ownerName },
    ],
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        createGroupTaskInStore(
          store,
          {
            departureGroupId: ctx.groupId,
            title: p.taskTitle,
            description: `${p.issueSummary}\n\nDrafted rework request for ${p.pilgrimName}:\n"${p.draftMessage}"`,
            ownerName: p.ownerName,
            ownerId: p.ownerId ?? null,
            dueAt: p.dueAt,
            category: "VISA",
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};
