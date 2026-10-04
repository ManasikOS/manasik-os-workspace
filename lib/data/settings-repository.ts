/**
 * Server-only read/write access for the Settings module.
 *
 * Same posture as `lib/data/team-repository.ts` / `lib/data/suppliers-repository.ts`:
 * this is the only file that touches Supabase for `agency_settings`, `branches`,
 * `message_templates`, `integration_connections` and `settings_activity_logs`.
 *
 * Every mutator writes exactly one `settings_activity_logs` row with before/after
 * values before returning — see the Settings plan D14. Nothing in this file
 * decides *whether* the caller may write; that is `capabilitiesForSettings()`,
 * checked in `actions.ts` before any of these functions are called.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ArchiveBranchInput,
  BranchInput,
  BranchRulesInput,
  BrandingSettingsInput,
  FinanceDefaultsInput,
  MessageTemplateInput,
  OperationalDefaultsInput,
  OrganisationSettingsInput,
  RetentionSettingsInput,
  SecurityDefaultsInput,
  UpdateIntegrationNotesInput,
} from "@/lib/validations/settings";
import type {
  AgencySettingsRow,
  AuditLogRow,
  BranchDirectoryRow,
  BranchRow,
  IntegrationConnectionRow,
  IntegrationProvider,
  MessageTemplateRow,
} from "@/lib/types/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class SettingsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    super(`Settings: ${operation} on ${table} failed — ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SettingsPersistenceError";
  }
}

export interface SettingsActor {
  id: string | null;
  name: string;
}

/* ── Activity log ─────────────────────────────────────────────────────────── */

async function logSettingsEvent(
  db: Db,
  input: {
    actor: SettingsActor;
    section: string;
    eventType: string;
    entityType?: string;
    entityId?: string;
    entityLabel?: string;
    beforeValue?: unknown;
    afterValue?: unknown;
    message?: string;
  },
): Promise<void> {
  const { error } = await db.from("settings_activity_logs").insert({
    actor_id: input.actor.id,
    actor_name_snapshot: input.actor.name,
    section: input.section,
    event_type: input.eventType,
    entity_type: input.entityType ?? "SETTINGS",
    entity_id: input.entityId ?? null,
    entity_label: input.entityLabel ?? null,
    before_value: input.beforeValue ?? null,
    after_value: input.afterValue ?? null,
    message: input.message ?? "",
  });
  if (error) throw new SettingsPersistenceError("settings_activity_logs", "insert", error);
}

/* ── B. agency_settings — the singleton ───────────────────────────────────── */

export async function getAgencySettings(db: Db): Promise<AgencySettingsRow> {
  const { data, error } = await db.from("agency_settings").select("*").eq("singleton", true).maybeSingle();
  if (error) throw new SettingsPersistenceError("agency_settings", "select", error);
  if (!data) throw new SettingsPersistenceError("agency_settings", "select", "No agency_settings row exists.");
  return data as AgencySettingsRow;
}

async function patchAgencySettings(
  db: Db,
  patch: Record<string, unknown>,
  actor: SettingsActor,
  section: string,
  eventType: string,
): Promise<AgencySettingsRow> {
  const before = await getAgencySettings(db);

  const { data, error } = await db
    .from("agency_settings")
    .update(patch)
    .eq("singleton", true)
    .select("*")
    .single();
  if (error) throw new SettingsPersistenceError("agency_settings", "update", error);

  await logSettingsEvent(db, {
    actor,
    section,
    eventType,
    beforeValue: before,
    afterValue: data,
  });

  return data as AgencySettingsRow;
}

/* ── §5.1 Organisation ────────────────────────────────────────────────────── */

export async function updateOrganisationSettings(
  db: Db,
  input: OrganisationSettingsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      agency_name: input.agencyName,
      legal_name: input.legalName || null,
      registration_number: input.registrationNumber || null,
      default_country: input.defaultCountry,
      default_currency: input.defaultCurrency,
      timezone: input.timezone,
      default_language: input.defaultLanguage,
      supported_languages: input.supportedLanguages,
      primary_email: input.primaryEmail || null,
      primary_whatsapp: input.primaryWhatsapp || null,
      office_address: input.officeAddress || null,
    },
    actor,
    "organisation",
    "ORGANISATION_UPDATED",
  );
}

/* ── §5.2 Branches ────────────────────────────────────────────────────────── */

export async function listBranches(db: Db): Promise<BranchDirectoryRow[]> {
  const { data, error } = await db
    .from("branch_directory_rows")
    .select("*")
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new SettingsPersistenceError("branch_directory_rows", "select", error);
  return (data ?? []) as BranchDirectoryRow[];
}

export type SaveBranchResult = { ok: true; branch: BranchRow } | { ok: false; error: string };

export async function saveBranch(db: Db, input: BranchInput, actor: SettingsActor): Promise<SaveBranchResult> {
  const payload = {
    name: input.name,
    code: input.code.toUpperCase(),
    address: input.address || null,
    phone: input.phone || null,
    email: input.email || null,
    manager_id: input.managerId || null,
    manager_name: input.managerName || null,
    default_currency: input.defaultCurrency,
    status: input.status,
    is_primary: input.isPrimary,
  };

  if (input.id) {
    const { data: before, error: beforeError } = await db
      .from("branches")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (beforeError) throw new SettingsPersistenceError("branches", "select", beforeError);
    if (!before) return { ok: false, error: "That branch no longer exists." };

    const { data, error } = await db.from("branches").update(payload).eq("id", input.id).select("*").single();
    if (error) {
      if (error.code === "23505") return { ok: false, error: "That branch code is already in use." };
      throw new SettingsPersistenceError("branches", "update", error);
    }

    await logSettingsEvent(db, {
      actor,
      section: "branches",
      eventType: "BRANCH_UPDATED",
      entityType: "BRANCH",
      entityId: data.id,
      entityLabel: data.name,
      beforeValue: before,
      afterValue: data,
    });
    return { ok: true, branch: data as BranchRow };
  }

  const { data, error } = await db.from("branches").insert(payload).select("*").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That branch code is already in use." };
    throw new SettingsPersistenceError("branches", "insert", error);
  }

  await logSettingsEvent(db, {
    actor,
    section: "branches",
    eventType: "BRANCH_CREATED",
    entityType: "BRANCH",
    entityId: data.id,
    entityLabel: data.name,
    afterValue: data,
  });
  return { ok: true, branch: data as BranchRow };
}

export type ArchiveBranchResult = { ok: true } | { ok: false; error: string };

export async function archiveBranch(
  db: Db,
  input: ArchiveBranchInput,
  actor: SettingsActor,
): Promise<ArchiveBranchResult> {
  const { count, error: countError } = await db
    .from("departure_groups")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", input.branchId)
    .not("group_status", "in", "(CANCELLED,COMPLETED)");
  if (countError) throw new SettingsPersistenceError("departure_groups", "select", countError);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "This branch has active departure groups and cannot be archived." };
  }

  const { data: before, error: beforeError } = await db
    .from("branches")
    .select("*")
    .eq("id", input.branchId)
    .maybeSingle();
  if (beforeError) throw new SettingsPersistenceError("branches", "select", beforeError);
  if (!before) return { ok: false, error: "That branch no longer exists." };

  const { data, error } = await db
    .from("branches")
    .update({ status: "ARCHIVED" })
    .eq("id", input.branchId)
    .select("*")
    .single();
  if (error) throw new SettingsPersistenceError("branches", "update", error);

  await logSettingsEvent(db, {
    actor,
    section: "danger",
    eventType: "BRANCH_ARCHIVED",
    entityType: "BRANCH",
    entityId: data.id,
    entityLabel: data.name,
    beforeValue: before,
    afterValue: data,
    message: `Archived branch ${data.name}.`,
  });
  return { ok: true };
}

export async function updateBranchRules(
  db: Db,
  input: BranchRulesInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(db, { branch_rules: input }, actor, "branches", "BRANCH_RULES_UPDATED");
}

/* ── §5.3 Branding & Pilgrim Portal ───────────────────────────────────────── */

export async function updateBrandingSettings(
  db: Db,
  input: BrandingSettingsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      logo_path: input.logoPath || null,
      portal_primary_colour: input.portalPrimaryColour,
      portal_secondary_colour: input.portalSecondaryColour || null,
      portal_welcome_message: input.portalWelcomeMessage || null,
      portal_support_whatsapp: input.portalSupportWhatsapp || null,
      portal_support_email: input.portalSupportEmail || null,
      website_url: input.websiteUrl || null,
      terms_url: input.termsUrl || null,
      invoice_footer: input.invoiceFooter || "",
      portal_flags: input.portalFlags,
    },
    actor,
    "branding",
    "BRANDING_UPDATED",
  );
}

/* ── §5.4 Operational Defaults ────────────────────────────────────────────── */

export async function updateOperationalDefaults(
  db: Db,
  input: OperationalDefaultsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      default_group_capacity: input.defaultGroupCapacity,
      minimum_group_size: input.minimumGroupSize,
      default_seat_hold_hours: input.defaultSeatHoldHours,
      default_guide_ratio: input.defaultGuideRatio,
      default_group_status: input.defaultGroupStatus,
      default_sales_status: input.defaultSalesStatus,
      waitlists_enabled_by_default: input.waitlistsEnabledByDefault,
      readiness_ready_threshold: input.readinessReadyThreshold,
      readiness_at_risk_threshold: input.readinessAtRiskThreshold,
      critical_flags: input.criticalFlags,
      passport_validity_months: input.passportValidityMonths,
      passport_photo_requirement: input.passportPhotoRequirement,
      document_reminder_days: input.documentReminderDays,
      document_rework_deadline_hours: input.documentReworkDeadlineHours,
      visa_escalation_days: input.visaEscalationDays,
      require_document_verification: input.requireDocumentVerification,
      require_visa_verification: input.requireVisaVerification,
    },
    actor,
    "operations",
    "OPERATIONAL_DEFAULTS_UPDATED",
  );
}

/* ── §5.5 Communication Templates ─────────────────────────────────────────── */

export async function listMessageTemplates(db: Db): Promise<MessageTemplateRow[]> {
  const { data, error } = await db
    .from("message_templates")
    .select("*")
    .order("category", { ascending: true })
    .order("channel", { ascending: true });
  if (error) throw new SettingsPersistenceError("message_templates", "select", error);
  return (data ?? []) as MessageTemplateRow[];
}

export type SaveTemplateResult = { ok: true; template: MessageTemplateRow } | { ok: false; error: string };

export async function saveMessageTemplate(
  db: Db,
  input: MessageTemplateInput,
  actor: SettingsActor,
): Promise<SaveTemplateResult> {
  const payload = {
    category: input.category,
    name: input.name,
    channel: input.channel,
    audience: input.audience,
    subject: input.subject || null,
    body: input.body,
    language: input.language,
    is_active: input.isActive,
    assigned_roles: input.assignedRoles,
  };

  if (input.id) {
    const { data: before, error: beforeError } = await db
      .from("message_templates")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (beforeError) throw new SettingsPersistenceError("message_templates", "select", beforeError);
    if (!before) return { ok: false, error: "That template no longer exists." };

    const { data, error } = await db
      .from("message_templates")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw new SettingsPersistenceError("message_templates", "update", error);

    await logSettingsEvent(db, {
      actor,
      section: "communications",
      eventType: "TEMPLATE_UPDATED",
      entityType: "TEMPLATE",
      entityId: data.id,
      entityLabel: data.name,
      beforeValue: before,
      afterValue: data,
    });
    return { ok: true, template: data as MessageTemplateRow };
  }

  const { data, error } = await db
    .from("message_templates")
    .insert({ ...payload, created_by: actor.id, created_by_name: actor.name })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A template already exists for that category, channel and language." };
    }
    throw new SettingsPersistenceError("message_templates", "insert", error);
  }

  await logSettingsEvent(db, {
    actor,
    section: "communications",
    eventType: "TEMPLATE_CREATED",
    entityType: "TEMPLATE",
    entityId: data.id,
    entityLabel: data.name,
    afterValue: data,
  });
  return { ok: true, template: data as MessageTemplateRow };
}

export async function deleteMessageTemplate(db: Db, templateId: string, actor: SettingsActor): Promise<void> {
  const { data: before, error: beforeError } = await db
    .from("message_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (beforeError) throw new SettingsPersistenceError("message_templates", "select", beforeError);
  if (!before) return;

  const { error } = await db.from("message_templates").delete().eq("id", templateId);
  if (error) throw new SettingsPersistenceError("message_templates", "delete", error);

  await logSettingsEvent(db, {
    actor,
    section: "communications",
    eventType: "TEMPLATE_DELETED",
    entityType: "TEMPLATE",
    entityId: templateId,
    entityLabel: before.name,
    beforeValue: before,
  });
}

/* ── §5.6 Finance Defaults ────────────────────────────────────────────────── */

export async function updateFinanceDefaults(
  db: Db,
  input: FinanceDefaultsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      default_currency: input.defaultCurrency,
      supported_currencies: input.supportedCurrencies,
      invoice_prefix: input.invoicePrefix,
      receipt_prefix: input.receiptPrefix,
      payment_prefix: input.paymentPrefix,
      supplier_bill_prefix: input.supplierBillPrefix,
      default_payment_terms: input.defaultPaymentTerms || "",
      enabled_payment_methods: input.enabledPaymentMethods,
      invoice_footer: input.invoiceFooter || "",
      auto_generate_receipt: input.autoGenerateReceipt,
      require_bank_proof: input.requireBankProof,
      margin_visible_roles: input.marginVisibleRoles,
    },
    actor,
    "finance",
    "FINANCE_DEFAULTS_UPDATED",
  );
}

/* ── §5.7 Integrations ────────────────────────────────────────────────────── */

export async function listIntegrations(db: Db): Promise<IntegrationConnectionRow[]> {
  const { data, error } = await db.from("integration_connections").select("*").order("provider", { ascending: true });
  if (error) throw new SettingsPersistenceError("integration_connections", "select", error);
  return (data ?? []) as IntegrationConnectionRow[];
}

export async function updateIntegrationNotes(
  db: Db,
  input: UpdateIntegrationNotesInput,
  actor: SettingsActor,
): Promise<IntegrationConnectionRow> {
  const { data: before, error: beforeError } = await db
    .from("integration_connections")
    .select("*")
    .eq("provider", input.provider)
    .maybeSingle();
  if (beforeError) throw new SettingsPersistenceError("integration_connections", "select", beforeError);

  const { data, error } = await db
    .from("integration_connections")
    .update({ notes: input.notes || null })
    .eq("provider", input.provider)
    .select("*")
    .single();
  if (error) throw new SettingsPersistenceError("integration_connections", "update", error);

  await logSettingsEvent(db, {
    actor,
    section: "integrations",
    eventType: "INTEGRATION_NOTES_UPDATED",
    entityType: "INTEGRATION",
    entityId: input.provider,
    entityLabel: input.provider,
    beforeValue: before,
    afterValue: data,
  });
  return data as IntegrationConnectionRow;
}

/** Which providers have a working connector today — F8 gates this to FILE_STORAGE. */
export function isIntegrationLive(provider: IntegrationProvider, hasStorage: boolean): boolean {
  return provider === "FILE_STORAGE" && hasStorage;
}

/* ── §5.8 Security & Access ───────────────────────────────────────────────── */

export async function updateSecurityDefaults(
  db: Db,
  input: SecurityDefaultsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      default_staff_role: input.defaultStaffRole,
      require_account_approval: input.requireAccountApproval,
      seasonal_auto_expiry_enabled: input.seasonalAutoExpiryEnabled,
      seasonal_expiry_days: input.seasonalExpiryDays,
      session_idle_timeout_minutes: input.sessionIdleTimeoutMinutes,
      access_restriction_flags: input.accessRestrictionFlags,
    },
    actor,
    "security",
    "SECURITY_DEFAULTS_UPDATED",
  );
}

export interface StaffSessionRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  last_active_at: string | null;
}

/** People, not sessions — `auth.sessions` is not readable from this app. See F6. */
export async function listStaffForSessionsCard(db: Db): Promise<StaffSessionRow[]> {
  const { data, error } = await db
    .from("staff_profiles")
    .select("id, full_name, email, role, status, last_active_at")
    .eq("status", "ACTIVE")
    .order("last_active_at", { ascending: false, nullsFirst: false });
  if (error) throw new SettingsPersistenceError("staff_profiles", "select", error);
  return (data ?? []) as StaffSessionRow[];
}

/* ── §5.9 Data & Audit ────────────────────────────────────────────────────── */

export async function updateRetentionSettings(
  db: Db,
  input: RetentionSettingsInput,
  actor: SettingsActor,
): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    {
      document_retention_years: input.documentRetentionYears,
      archived_group_retention_years: input.archivedGroupRetentionYears,
      deactivated_user_retention_years: input.deactivatedUserRetentionYears,
      immutable_finance_history: input.immutableFinanceHistory,
      keep_document_verification_history: input.keepDocumentVerificationHistory,
    },
    actor,
    "data",
    "RETENTION_SETTINGS_UPDATED",
  );
}

export interface AuditLogFilters {
  actorId?: string;
  source?: string;
  entityType?: string;
  branch?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export async function loadAuditLog(db: Db, filters: AuditLogFilters = {}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  let query = db.from("audit_log_rows").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.fromDate) query = query.gte("created_at", filters.fromDate);
  if (filters.toDate) query = query.lte("created_at", filters.toDate);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new SettingsPersistenceError("audit_log_rows", "select", error);
  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 };
}

export async function requestFullExport(db: Db, actor: SettingsActor): Promise<void> {
  await logSettingsEvent(db, {
    actor,
    section: "danger",
    eventType: "FULL_EXPORT_REQUESTED",
    message: `${actor.name} requested a full agency data export.`,
  });
}

export interface ResetAgencyDataResult {
  ok: boolean;
  error?: string;
  /** Per-table row counts from `reset_agency_business_data()`, for an honest receipt. */
  deletedByTable?: { table: string; rows: number }[];
  totalRowsDeleted?: number;
}

/**
 * Calls `reset_agency_business_data(p_agency_id)` (migrations `20260912090000`, `20261126090001`) and
 * logs exactly one event afterward — `settings_activity_logs` is itself one
 * of the tables that function wipes, so this is deliberately the FIRST row
 * in the log after a reset, not a "before" entry that would be deleted by
 * its own action.
 */
export async function resetAgencyBusinessData(
  db: Db,
  /**
   * A service-role client. The database function is executable by the service role only, so the checks that
   * matter (ADMIN, not production, typed phrase) live in the caller and cannot be skipped by a browser session.
   */
  serviceDb: Db,
  agencyId: string,
  actor: SettingsActor,
): Promise<ResetAgencyDataResult> {
  const { data, error } = await serviceDb.rpc("reset_agency_business_data", { p_agency_id: agencyId });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as { table_name: string; rows_deleted: number }[];
  const deletedByTable = rows.map((r) => ({ table: r.table_name, rows: Number(r.rows_deleted) }));
  const totalRowsDeleted = deletedByTable.reduce((sum, r) => sum + r.rows, 0);

  await logSettingsEvent(db, {
    actor,
    section: "danger",
    eventType: "AGENCY_DATA_RESET",
    message: `${actor.name} reset this agency to a factory state — ${totalRowsDeleted} row${
      totalRowsDeleted === 1 ? "" : "s"
    } deleted across ${deletedByTable.length} tables. Staff accounts and configuration were kept.`,
  });

  return { ok: true, deletedByTable, totalRowsDeleted };
}

/* ── §5.10 Danger Zone ────────────────────────────────────────────────────── */

export async function setPortalActive(db: Db, active: boolean, actor: SettingsActor): Promise<AgencySettingsRow> {
  return patchAgencySettings(
    db,
    { portal_active: active },
    actor,
    "danger",
    active ? "PORTAL_ACTIVATED" : "PORTAL_DEACTIVATED",
  );
}
