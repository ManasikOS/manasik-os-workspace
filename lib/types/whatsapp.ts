/**
 * Row shapes for the WhatsApp channel tables — see
 * supabase/migrations/20260825090000_whatsapp_channel.sql. Mirrors the
 * loosely-typed `SupabaseClient<any, any, any>` convention every other
 * `lib/data/*-repository.ts` module already uses: `.select("*")` plus a cast
 * against these interfaces, rather than generated table types.
 */

import type { ChannelProvider } from "@/lib/inbox/contracts";

export type WhatsAppIntegrationStatus =
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "UNFUNDED"
  | "ERROR"
  | "DISCONNECTED"
  | "PENDING_REVIEW"
  | "RESTRICTED";

export type WhatsAppConnectionMode = "OWN_APP_TOKEN" | "EMBEDDED_SIGNUP";
export type WhatsAppFundingStatus = "UNKNOWN" | "FUNDED" | "UNFUNDED";
export type WhatsAppOnboardingStep =
  | "NOT_STARTED"
  | "TOKEN_STORED"
  | "SUBSCRIBED"
  | "REGISTERED"
  | "WEBHOOK_VERIFIED"
  | "COMPLETE";

export interface WhatsAppIntegrationRow {
  id: string;
  agency_id: string;
  provider: "META";
  business_account_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  business_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  credential_ref: string | null;
  credential_hint: string | null;
  status: WhatsAppIntegrationStatus;
  verified_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  connected_by_name: string | null;
  // §5 E1 of docs/modules/whatsapp-meta-connection-implementation-plan.md
  connection_mode: WhatsAppConnectionMode;
  connection_key: string | null;
  meta_business_id: string | null;
  app_secret_ref: string | null;
  verify_token_ref: string | null;
  two_step_pin_ref: string | null;
  token_expires_at: string | null;
  token_scopes: string[] | null;
  subscribed_at: string | null;
  registered_at: string | null;
  webhook_verified_at: string | null;
  funding_status: WhatsAppFundingStatus;
  onboarding_step: WhatsAppOnboardingStep;
  platform_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ConversationState =
  | "AI_ACTIVE"
  | "HUMAN_REQUESTED"
  | "HUMAN_ACTIVE"
  | "AI_RESUMED"
  | "CLOSED";

export interface ConversationRow {
  id: string;
  agency_id: string;
  /** Which channel this thread lives on. The table has always been provider-neutral; only this type was WhatsApp-only. */
  channel: ChannelProvider;
  /** The customer's id on that channel: wa_id, Messenger PSID, or Instagram IGSID. */
  external_conversation_id: string;
  lead_id: string | null;
  contact_name: string;
  contact_phone: string;
  state: ConversationState;
  ai_enabled: boolean;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  service_window_expires_at: string | null;
  human_agent_window_expires_at?: string | null;
  handling_mode?: "AI_ACTIVE" | "AI_PAUSED" | "HUMAN_REQUESTED" | "HUMAN_ACTIVE" | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  /** Set once from the opening message's click-to-chat tracking code, before a lead exists — see lib/whatsapp/campaign-attribution.ts. */
  attributed_campaign_id: string | null;
  attribution_channel: string | null;
  attribution_tracking_code: string | null;
  attribution_source_detail: string | null;
  attribution_confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  attribution_captured_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant" | "staff" | "system" | "tool";
export type MessageActorKind = "CUSTOMER" | "AI" | "STAFF" | "SYSTEM";
export type MessageType = "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
export type DeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface ConversationMessageRow {
  id: string;
  agency_id: string;
  conversation_id: string;
  external_message_id: string | null;
  role: MessageRole;
  actor_kind: MessageActorKind;
  actor_id: string | null;
  actor_name_snapshot: string | null;
  content: string;
  message_type: MessageType;
  media_path: string | null;
  delivery_status: DeliveryStatus;
  delivery_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AgentJobKind = "PROCESS_INBOUND" | "TRANSCRIBE_AUDIO" | "EMBED_DOCUMENT" | "RECONCILE_ECHO";
export type AgentJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "DEAD";

export interface AgentJobRow {
  id: string;
  agency_id: string;
  kind: AgentJobKind;
  payload: Record<string, unknown>;
  status: AgentJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal shape of a Meta Cloud API webhook delivery — only the fields this app reads. */
export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; filename?: string };
          /** A tapped reply button — see sendInteractiveButtons() in lib/whatsapp/client.ts. */
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
          };
          /** Sent when the customer taps an emoji reaction on one of our messages; `type` is "reaction". Never stored as its own message. */
          reaction?: { message_id?: string; emoji?: string };
        }>;
        /** `smb_message_echoes`: messages the agency sent from the WhatsApp Business app itself (coexistence). */
        message_echoes?: Array<{
          id?: string;
          from?: string;
          to?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
          /** Staff tapping a reaction on a customer message from their own phone echoes here too; never stored. */
          reaction?: { message_id?: string; emoji?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number; title?: string }>;
          /** Billability for this delivered message — F15. Present on `sent`/`delivered` status entries. */
          pricing?: {
            billable?: boolean;
            pricing_model?: string; // 'PMP' | 'CBP'
            category?: string; // marketing | utility | authentication | service
            type?: string; // regular | free_customer_service | free_entry_point
          };
          conversation?: { id?: string; origin?: { type?: string } };
        }>;
        /** account_update field — verification/eligibility/violation/tier events (F10/F15). Shape varies by event; kept loose. */
        event?: string;
        ban_info?: { waba_ban_state?: string; waba_ban_date?: string };
        violation_info?: { violation_type?: string };
        tier_update_time?: number;
        pricing_category?: string;
        tier?: { lower?: number; upper?: number };
        effective_month?: string;
        region?: string;
      };
    }>;
  }>;
}

/* ── §5 E1/E10 of docs/modules/whatsapp-meta-connection-implementation-plan.md ──── */

export interface WhatsAppConnectionEventRow {
  id: string;
  agency_id: string;
  integration_id: string | null;
  kind: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export type WhatsAppTemplateStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
export type WhatsAppTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface WhatsAppTemplateRow {
  id: string;
  agency_id: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  status: WhatsAppTemplateStatus;
  components: unknown[];
  external_template_id: string | null;
  rejected_reason: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMessageChargeRow {
  id: string;
  agency_id: string;
  conversation_id: string | null;
  message_id: string | null;
  external_message_id: string;
  direction: "OUTBOUND" | "INBOUND";
  billable: boolean;
  pricing_model: string | null;
  pricing_category: string | null;
  pricing_type: string | null;
  recipient_country: string | null;
  template_name: string | null;
  template_id: string | null;
  actor_kind: "AI" | "STAFF" | "SYSTEM" | null;
  actor_id: string | null;
  lead_id: string | null;
  departure_group_id: string | null;
  estimated_cost: number | null;
  estimated_currency: string | null;
  rate_observation_id: string | null;
  charged_on: string | null;
  created_at: string;
}

export interface WhatsAppRateObservationRow {
  id: string;
  agency_id: string;
  observed_on: string;
  country_code: string;
  pricing_category: string;
  pricing_type: string;
  tier: string;
  cost: number;
  volume: number;
  unit_rate: number;
  currency: string;
  created_at: string;
}

export interface WhatsAppBillingDailyRow {
  id: string;
  agency_id: string;
  day: string;
  phone_number_id: string;
  country_code: string;
  pricing_category: string;
  pricing_type: string;
  tier: string;
  cost: number;
  volume: number;
  currency: string;
  source: "PRICING_ANALYTICS" | "CONVERSATION_ANALYTICS";
  synced_at: string;
}

export interface WhatsAppVolumeTierRow {
  id: string;
  agency_id: string;
  pricing_category: string;
  region: string;
  tier_lower: number | null;
  tier_upper: number | null;
  effective_month: string | null;
  tier_update_time: string;
  created_at: string;
}

export interface WhatsAppBillingBudgetRow {
  agency_id: string;
  monthly_budget: number | null;
  currency: string | null;
  alert_at_percent: number[];
  block_marketing_at_100: boolean;
  notify_role: "ADMIN" | "CEO" | "FINANCE";
  last_alerted_percent: number;
  updated_at: string;
}

export interface AiModelRateRow {
  model: string;
  effective_from: string;
  input_rate_per_million: number;
  output_rate_per_million: number;
  cache_read_rate_per_million: number;
  cache_write_rate_per_million: number;
  currency: string;
}
