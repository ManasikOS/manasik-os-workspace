/**
 * DepartureOpsContext — the trusted identity every tool and guardrail
 * receives, built once per review from server-side state and never from
 * anything the model produced. Mirrors `lib/agent/whatsapp/context.ts`'s
 * own rule: `agencyId` and `groupId` are never a tool argument the model
 * could set, because a tool schema that accepted either would let the
 * model choose which group's — or which agency's — data it touches.
 *
 * Simpler than the WhatsApp context by construction: there is no
 * conversation to resolve identity from. The caller (Phase 5's job
 * handler) already knows which group it is reviewing before this context
 * is built.
 */

import "server-only";

import type { Db } from "@/lib/data/departure-groups-repository";

export interface DepartureOpsContext {
  agencyId: string;
  groupId: string;
  db: Db;
}
