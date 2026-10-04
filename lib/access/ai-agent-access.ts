import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Manasik Copilot management screen — persona/capability
 * switches, observability, the knowledge base. Same posture as every other
 * `*-access.ts` file. See §11 of docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Deliberately narrower than Inbox: configuring what the agent is allowed to
 * do is an ADMIN-only write, matching `ai_settings`' own RLS policy
 * (supabase/migrations/20260826090000_ai_agent.sql §D) — a mismatch here
 * would just mean the UI offers a save button RLS silently rejects.
 */

export interface AiAgentCapabilities {
  viewModule: boolean;
  editSettings: boolean;
  manageKnowledgeBase: boolean;
  viewAnalytics: boolean;
}

const NONE: AiAgentCapabilities = {
  viewModule: false,
  editSettings: false,
  manageKnowledgeBase: false,
  viewAnalytics: false,
};

const CAPABILITIES: Record<StaffRole, AiAgentCapabilities> = {
  ADMIN: { viewModule: true, editSettings: true, manageKnowledgeBase: true, viewAnalytics: true },
  CEO: { ...NONE, viewModule: true, viewAnalytics: true },
  // No viewAnalytics: agent_runs / agent_tool_calls RLS is ADMIN + CEO only, so granting it here
  // would show MARKETING an empty section that looks like "no activity" rather than "no access".
  MARKETING: { ...NONE, viewModule: true },
  FINANCE: { ...NONE },
  OPERATIONS: { ...NONE },
  VISA: { ...NONE },
  GUIDE: { ...NONE },
};

export function capabilitiesForAiAgent(role: StaffRole): AiAgentCapabilities {
  return CAPABILITIES[role];
}
