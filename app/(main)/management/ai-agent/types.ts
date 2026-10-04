export interface AiSettingsRow {
  agency_id: string;
  enabled: boolean;
  agent_name: string;
  persona_instructions: string;
  languages: string[];
  tone: "FRIENDLY_PROFESSIONAL" | "FORMAL" | "CONCISE";
  lead_capture_enabled: boolean;
  booking_enabled: boolean;
  handoff_enabled: boolean;
  behaviour: unknown;
  seat_hold_hours: number;
  max_turns_per_conversation: number;
  escalate_after_failed_turns: number;
  out_of_hours_message: string;
}

export interface AgentRunRow {
  id: string;
  /** WHATSAPP, MESSENGER or INSTAGRAM. */
  channel: "WHATSAPP" | "MESSENGER" | "INSTAGRAM";
  status: "OK" | "TOOL_ERROR" | "MODEL_ERROR" | "GUARDRAIL_BLOCKED" | "REFUSAL";
  model: string;
  effort: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
  error: string | null;
}

/** The departure_ops_* columns on ai_settings — see DepartureOpsAiSettings in lib/agent/kernel/proposals/types.ts, restated here as a plain row shape for this page's own form state. */
export interface DepartureOpsSettingsRow {
  departure_ops_enabled: boolean;
  departure_ops_mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE";
  departure_ops_max_proposals_per_run: number;
  departure_ops_max_tasks_per_run: number;
  departure_ops_high_risk_roles: string[];
  departure_ops_rejection_cooldown_days: number;
}

export interface DepartureOpsRunRow {
  id: string;
  departure_group_id: string;
  status: string;
  model: string;
  effort: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
  error: string | null;
}

/** The follow-up and waiting-customer alert columns on ai_settings (supabase/migrations/20261201090000_lead_retention_followups.sql). */
export interface FollowupSettingsRow {
  followups_enabled: boolean;
  followups_dry_run: boolean;
  followup_delays_hours: number[];
  followup_message_text: string;
  followup_whatsapp_template_id: string | null;
  handoff_alert_minutes: number;
  handoff_escalation_minutes: number;
}

/** An approved WhatsApp template the follow-up can use after the 24-hour window (needs at most one variable, the customer's first name). */
export interface FollowupTemplateOption {
  id: string;
  name: string;
}
