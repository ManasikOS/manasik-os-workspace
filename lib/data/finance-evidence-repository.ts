import "server-only";

import { createHash } from "node:crypto";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { Db } from "@/lib/ai/db";
import {
  canDecideFinanceEvidence,
  canReviewFinanceEvidence,
  matchFinanceEvidenceToPayments,
  type EvidenceMatchResult,
  type EvidenceMatchingPayment,
} from "@/lib/finance/evidence-matching";
import {
  financeEvidenceDestinationPath,
  financeEvidenceRetentionExpiry,
  receiptCandidateFromAnalysis,
} from "@/lib/finance/finance-evidence";
const INBOX_ATTACHMENT_BUCKET = "inbox-attachments";
const FINANCE_EVIDENCE_BUCKET = "payment-proofs";
const FINANCE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const MATCHING_QUEUE_DEFAULT_LIMIT = 50;
const MATCHING_QUEUE_MAX_LIMIT = 100;

export interface FinanceEvidenceSource {
  agencyId: string;
  conversationId: string;
  messageId: string;
  attachmentId: string;
  analysisId: string;
  assignedToId: string | null;
  leadId: string | null;
  bookingId: string | null;
  departureGroupId: string | null;
  customerId: string | null;
  sourceStoragePath: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  candidateFields: Record<string, unknown>;
  confidence: number | null;
  retentionDays: number;
}

export interface FinanceEvidenceRecord {
  id: string;
  agency_id: string;
  source_attachment_id: string;
  storage_path: string;
  status: "PENDING_REVIEW" | "MATCHED_TO_PAYMENT" | "DISMISSED";
  payment_id: string | null;
}

interface FinanceEvidenceInsertRow {
  agency_id: string;
  source_conversation_id: string;
  source_message_id: string;
  source_attachment_id: string;
  source_media_analysis_id: string;
  lead_id: string | null;
  booking_id: string | null;
  departure_group_id: string | null;
  customer_id: string | null;
  storage_path: string;
  original_checksum_sha256: string;
  original_mime_type: string;
  candidate_amount: number | null;
  candidate_reference: string | null;
  candidate_date: string | null;
  candidate_confidence: number | null;
  candidate_attribution: Record<string, unknown>;
  created_by: string | null;
  created_by_name: string;
  retention_expires_at: string;
}

interface FinanceEvidenceAuditRow {
  id: string;
  agency_id: string;
  booking_id: string | null;
  departure_group_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: "NOTE_ADDED";
  to_value: string;
  note: string;
  is_high_impact: false;
}

export interface PendingFinanceEvidence {
  id: string;
  agencyId: string;
  amount: number | null;
  reference: string | null;
  date: string | null;
  bookingId: string | null;
  departureGroupId: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
}

export type AgencyScopedEvidencePayment = EvidenceMatchingPayment & { agencyId: string };

export type ReviewableFinanceEvidence = PendingFinanceEvidence & {
  status: "PENDING_REVIEW" | "MATCHED_TO_PAYMENT" | "DISMISSED";
  paymentId: string | null;
};

export type FinanceEvidenceReviewActor = { id: string | null; name: string; role: string };

export type FinanceEvidenceReviewResult =
  | { ok: true; status: "MATCHED_TO_PAYMENT" | "DISMISSED"; paymentId: string | null }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "ALREADY_REVIEWED" | "NOT_A_CANDIDATE" | "PAYMENT_ALREADY_LINKED" | "REASON_REQUIRED";
      error: string;
    };

interface FinanceEvidenceReviewRow {
  agencyId: string;
  evidenceId: string;
  status: "MATCHED_TO_PAYMENT" | "DISMISSED";
  paymentId: string | null;
  actor: FinanceEvidenceReviewActor;
  note: string | null;
  reviewedAt: string;
}

interface FinanceEvidenceReviewAuditRow extends Omit<FinanceEvidenceAuditRow, "to_value"> {
  payment_id: string | null;
  to_value: string;
}

const REVIEW_REASON_MAX_LENGTH = 500;

/** One review audit event per evidence item: a retry rewrites the same id instead of adding a second. */
function financeEvidenceReviewAuditId(evidenceId: string): string {
  const hex = createHash("sha256").update(`finance-evidence-review:${evidenceId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface UnmatchedFinanceEvidenceItem {
  evidence: PendingFinanceEvidence;
  match: EvidenceMatchResult;
}

interface FinanceEvidenceRepositoryDependencies {
  loadSource(agencyId: string, attachmentId: string): Promise<FinanceEvidenceSource | null>;
  findEvidence(agencyId: string, attachmentId: string): Promise<FinanceEvidenceRecord | null>;
  copyObject(source: FinanceEvidenceSource, destinationPath: string): Promise<void>;
  insertEvidence(row: FinanceEvidenceInsertRow): Promise<{ row: FinanceEvidenceRecord; inserted: boolean }>;
  ensureAudit(row: FinanceEvidenceAuditRow): Promise<void>;
  listPendingEvidence(agencyId: string, limit: number): Promise<PendingFinanceEvidence[]>;
  listPaymentCandidates(agencyId: string, evidence: readonly PendingFinanceEvidence[]): Promise<AgencyScopedEvidencePayment[]>;
  findLinkedPaymentIds(agencyId: string, paymentIds: readonly string[]): Promise<ReadonlySet<string>>;
  loadEvidenceForReview(agencyId: string, evidenceId: string): Promise<ReviewableFinanceEvidence | null>;
  loadPaymentForReview(agencyId: string, paymentId: string): Promise<AgencyScopedEvidencePayment | null>;
  /** Must update only a row that is still PENDING_REVIEW and report whether it did. */
  recordReview(row: FinanceEvidenceReviewRow): Promise<{ applied: boolean }>;
  ensureReviewAudit(row: FinanceEvidenceReviewAuditRow): Promise<void>;
}

function reviewRow(
  input: { agencyId: string; evidenceId: string; actor: FinanceEvidenceReviewActor; now?: Date },
  status: "MATCHED_TO_PAYMENT" | "DISMISSED",
  paymentId: string | null,
  note: string | null,
): FinanceEvidenceReviewRow {
  return {
    agencyId: input.agencyId,
    evidenceId: input.evidenceId,
    status,
    paymentId,
    actor: input.actor,
    note,
    reviewedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function createFinanceEvidenceRepository(dependencies: FinanceEvidenceRepositoryDependencies) {
  async function settleReview(
    row: FinanceEvidenceReviewRow,
    evidence: ReviewableFinanceEvidence,
    paymentReference: string | null,
    paymentBookingId: string | null,
  ): Promise<FinanceEvidenceReviewResult> {
    const { applied } = await dependencies.recordReview(row);
    if (!applied) {
      const current = await dependencies.loadEvidenceForReview(row.agencyId, row.evidenceId);
      const sameDecision = current?.status === row.status && current.paymentId === row.paymentId;
      if (!sameDecision) return { ok: false, code: "ALREADY_REVIEWED", error: "Another reviewer has already decided this receipt." };
    }
    await dependencies.ensureReviewAudit({
      id: financeEvidenceReviewAuditId(row.evidenceId),
      agency_id: row.agencyId,
      booking_id: paymentBookingId ?? evidence.bookingId,
      departure_group_id: evidence.departureGroupId,
      payment_id: row.paymentId,
      actor_id: row.actor.id,
      actor_name: row.actor.name,
      actor_role: row.actor.role,
      action: "NOTE_ADDED",
      to_value: row.evidenceId,
      note: row.status === "MATCHED_TO_PAYMENT"
        ? `Receipt evidence matched to payment ${paymentReference ?? row.paymentId} by Finance review. No payment was verified, allocated, or changed.`
        : `Receipt evidence dismissed by Finance review: ${row.note}. No payment was created or changed.`,
      is_high_impact: false,
    });
    return { ok: true, status: row.status, paymentId: row.paymentId };
  }

  return {
    /** Links reviewed evidence to one deterministic candidate. Never verifies, allocates, or edits the payment. */
    async matchEvidenceToPayment(input: {
      agencyId: string;
      evidenceId: string;
      paymentId: string;
      actor: FinanceEvidenceReviewActor;
      now?: Date;
    }): Promise<FinanceEvidenceReviewResult> {
      if (!canDecideFinanceEvidence(input.actor.role as StaffRole)) {
        return { ok: false, code: "FORBIDDEN", error: "Your role cannot match receipt evidence to a payment." };
      }
      const evidence = await dependencies.loadEvidenceForReview(input.agencyId, input.evidenceId);
      if (!evidence || evidence.agencyId !== input.agencyId) {
        return { ok: false, code: "NOT_FOUND", error: "That receipt evidence could not be found." };
      }
      const payment = await dependencies.loadPaymentForReview(input.agencyId, input.paymentId);
      if (evidence.status === "MATCHED_TO_PAYMENT" && evidence.paymentId === input.paymentId) {
        return settleReview(reviewRow(input, "MATCHED_TO_PAYMENT", input.paymentId, null), evidence, payment?.paymentReference ?? null, payment?.bookingId ?? null);
      }
      if (evidence.status !== "PENDING_REVIEW") {
        return { ok: false, code: "ALREADY_REVIEWED", error: "This receipt has already been reviewed." };
      }
      const candidate = payment && payment.agencyId === input.agencyId
        ? matchFinanceEvidenceToPayments(
            { id: evidence.id, amount: evidence.amount, reference: evidence.reference, date: evidence.date, bookingId: evidence.bookingId, departureGroupId: evidence.departureGroupId, status: "PENDING_REVIEW" },
            [payment],
          ).candidates[0]
        : undefined;
      if (!payment || !candidate) {
        return { ok: false, code: "NOT_A_CANDIDATE", error: "That payment is not a valid match for this receipt." };
      }
      const linked = await dependencies.findLinkedPaymentIds(input.agencyId, [payment.paymentId]);
      if (linked.has(payment.paymentId)) {
        return { ok: false, code: "PAYMENT_ALREADY_LINKED", error: "Another receipt is already matched to that payment." };
      }
      return settleReview(reviewRow(input, "MATCHED_TO_PAYMENT", payment.paymentId, null), evidence, payment.paymentReference, payment.bookingId);
    },

    /** Closes evidence as not payment proof. The reason is mandatory and audited. */
    async dismissFinanceEvidence(input: {
      agencyId: string;
      evidenceId: string;
      reason: string;
      actor: FinanceEvidenceReviewActor;
      now?: Date;
    }): Promise<FinanceEvidenceReviewResult> {
      if (!canDecideFinanceEvidence(input.actor.role as StaffRole)) {
        return { ok: false, code: "FORBIDDEN", error: "Your role cannot dismiss receipt evidence." };
      }
      const reason = input.reason.trim().slice(0, REVIEW_REASON_MAX_LENGTH);
      if (!reason) return { ok: false, code: "REASON_REQUIRED", error: "Enter a reason before dismissing this receipt." };
      const evidence = await dependencies.loadEvidenceForReview(input.agencyId, input.evidenceId);
      if (!evidence || evidence.agencyId !== input.agencyId) {
        return { ok: false, code: "NOT_FOUND", error: "That receipt evidence could not be found." };
      }
      if (evidence.status !== "PENDING_REVIEW" && evidence.status !== "DISMISSED") {
        return { ok: false, code: "ALREADY_REVIEWED", error: "This receipt has already been reviewed." };
      }
      return settleReview(reviewRow(input, "DISMISSED", null, reason), evidence, null, null);
    },

    loadReceiptSource: dependencies.loadSource,
    /**
     * Read-only: lists pending evidence with deterministic payment candidates.
     * Nothing is applied; ambiguous evidence stays unmatched for a human.
     */
    async listUnmatchedEvidenceWithCandidates(input: {
      agencyId: string;
      viewerRole: StaffRole;
      limit?: number;
    }): Promise<UnmatchedFinanceEvidenceItem[]> {
      if (!canReviewFinanceEvidence(input.viewerRole)) {
        throw new Error("Finance review access is required to see receipt evidence");
      }
      const limit = Math.min(MATCHING_QUEUE_MAX_LIMIT, Math.max(1, Math.trunc(input.limit ?? MATCHING_QUEUE_DEFAULT_LIMIT)));
      const evidence = (await dependencies.listPendingEvidence(input.agencyId, limit))
        .filter((item) => item.agencyId === input.agencyId);
      if (evidence.length === 0) return [];

      const sameAgencyPayments = (await dependencies.listPaymentCandidates(input.agencyId, evidence))
        .filter((payment) => payment.agencyId === input.agencyId);
      const linked = await dependencies.findLinkedPaymentIds(input.agencyId, sameAgencyPayments.map((payment) => payment.paymentId));
      const available = sameAgencyPayments.filter((payment) => !linked.has(payment.paymentId));

      return evidence.map((item) => ({
        evidence: item,
        match: matchFinanceEvidenceToPayments(
          {
            id: item.id,
            amount: item.amount,
            reference: item.reference,
            date: item.date,
            bookingId: item.bookingId,
            departureGroupId: item.departureGroupId,
            status: "PENDING_REVIEW",
          },
          available,
        ),
      }));
    },
    async copyReceiptEvidence(input: {
      agencyId: string;
      attachmentId: string;
      actor: { id: string | null; name: string; role: string };
      now?: Date;
      source?: FinanceEvidenceSource;
    }): Promise<FinanceEvidenceRecord> {
      const source = input.source ?? await dependencies.loadSource(input.agencyId, input.attachmentId);
      if (!source || source.agencyId !== input.agencyId || source.attachmentId !== input.attachmentId) {
        throw new Error("Receipt attachment not found");
      }
      if (!source.sourceStoragePath.startsWith(`${input.agencyId}/`)) {
        throw new Error("Receipt attachment storage path is outside the caller's agency");
      }
      if (!Number.isSafeInteger(source.byteSize) || source.byteSize < 1 || source.byteSize > FINANCE_EVIDENCE_MAX_BYTES) {
        throw new Error("Receipt attachment exceeds the Finance evidence size limit");
      }

      const existing = await dependencies.findEvidence(input.agencyId, input.attachmentId);
      if (existing) {
        await dependencies.ensureAudit(financeEvidenceAudit(existing, source, input.actor));
        return existing;
      }

      const destinationPath = financeEvidenceDestinationPath(source);
      await dependencies.copyObject(source, destinationPath);
      const candidate = receiptCandidateFromAnalysis(source.candidateFields, source.confidence);
      const now = input.now ?? new Date();
      const created = await dependencies.insertEvidence({
        agency_id: input.agencyId,
        source_conversation_id: source.conversationId,
        source_message_id: source.messageId,
        source_attachment_id: source.attachmentId,
        source_media_analysis_id: source.analysisId,
        lead_id: source.leadId,
        booking_id: source.bookingId,
        departure_group_id: source.departureGroupId,
        customer_id: source.customerId,
        storage_path: destinationPath,
        original_checksum_sha256: source.checksumSha256,
        original_mime_type: source.mimeType,
        candidate_amount: candidate.amount,
        candidate_reference: candidate.reference,
        candidate_date: candidate.date,
        candidate_confidence: candidate.confidence,
        candidate_attribution: candidate.attribution,
        created_by: input.actor.id,
        created_by_name: input.actor.name,
        retention_expires_at: financeEvidenceRetentionExpiry(now.toISOString(), source.retentionDays),
      });
      await dependencies.ensureAudit(financeEvidenceAudit(created.row, source, input.actor));
      return created.row;
    },
  };
}

function financeEvidenceAudit(
  evidence: FinanceEvidenceRecord,
  source: FinanceEvidenceSource,
  actor: { id: string | null; name: string; role: string },
): FinanceEvidenceAuditRow {
  return {
    id: evidence.id,
    agency_id: source.agencyId,
    booking_id: source.bookingId,
    departure_group_id: source.departureGroupId,
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    action: "NOTE_ADDED",
    to_value: evidence.id,
    note: "Receipt evidence copied from Inbox for Finance review. No payment was created or verified.",
    is_high_impact: false,
  };
}

export function createSupabaseFinanceEvidenceRepository(db: Db) {
  return createFinanceEvidenceRepository({
    async loadSource(agencyId, attachmentId) {
      const { data: attachment, error: attachmentError } = await db
        .from("message_attachments")
        .select("id,message_id,storage_path,mime_type,byte_size,checksum_sha256,scan_status")
        .eq("agency_id", agencyId)
        .eq("id", attachmentId)
        .maybeSingle();
      if (attachmentError) throw new Error(`Could not load receipt attachment: ${attachmentError.message}`);
      if (!attachment || attachment.scan_status !== "CLEAN" || !attachment.storage_path || !attachment.byte_size || !attachment.checksum_sha256) return null;

      const { data: analysis, error: analysisError } = await db
        .from("message_media_analyses")
        .select("id,message_id,kind,status,candidate_fields,confidence")
        .eq("agency_id", agencyId)
        .eq("attachment_id", attachmentId)
        .eq("message_id", attachment.message_id)
        .maybeSingle();
      if (analysisError) throw new Error(`Could not load receipt analysis: ${analysisError.message}`);
      if (!analysis || analysis.kind !== "RECEIPT" || analysis.status !== "READY") return null;

      const { data: message, error: messageError } = await db
        .from("conversation_messages")
        .select("id,conversation_id")
        .eq("agency_id", agencyId)
        .eq("id", attachment.message_id)
        .maybeSingle();
      if (messageError) throw new Error(`Could not load receipt message: ${messageError.message}`);
      if (!message) return null;

      const { data: conversation, error: conversationError } = await db
        .from("conversations")
        .select("id,assigned_to_id,lead_id,contact_identity_id")
        .eq("agency_id", agencyId)
        .eq("id", message.conversation_id)
        .maybeSingle();
      if (conversationError) throw new Error(`Could not load receipt conversation: ${conversationError.message}`);
      if (!conversation) return null;

      const leadPromise = conversation.lead_id
        ? db.from("leads").select("id,booking_id,selected_departure_group_id").eq("agency_id", agencyId).eq("id", conversation.lead_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const identityPromise = conversation.contact_identity_id
        ? db.from("contact_identities").select("pilgrim_id").eq("agency_id", agencyId).eq("id", conversation.contact_identity_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const settingsPromise = db.from("agency_settings").select("inbox_attachment_retention_days").eq("agency_id", agencyId).maybeSingle();
      const [{ data: lead, error: leadError }, { data: identity, error: identityError }, { data: settings, error: settingsError }] = await Promise.all([
        leadPromise,
        identityPromise,
        settingsPromise,
      ]);
      if (leadError || identityError || settingsError) throw new Error("Could not derive the receipt's agency context");

      return {
        agencyId,
        conversationId: String(message.conversation_id),
        messageId: String(message.id),
        attachmentId: String(attachment.id),
        analysisId: String(analysis.id),
        assignedToId: (conversation.assigned_to_id as string | null) ?? null,
        leadId: (conversation.lead_id as string | null) ?? null,
        bookingId: (lead?.booking_id as string | null) ?? null,
        departureGroupId: (lead?.selected_departure_group_id as string | null) ?? null,
        customerId: (identity?.pilgrim_id as string | null) ?? null,
        sourceStoragePath: String(attachment.storage_path),
        mimeType: String(attachment.mime_type),
        byteSize: Number(attachment.byte_size),
        checksumSha256: String(attachment.checksum_sha256).toLowerCase(),
        candidateFields: (analysis.candidate_fields ?? {}) as Record<string, unknown>,
        confidence: analysis.confidence === null ? null : Number(analysis.confidence),
        retentionDays: Number(settings?.inbox_attachment_retention_days ?? 90),
      };
    },
    async findEvidence(agencyId, attachmentId) {
      const { data, error } = await db
        .from("finance_evidence_intake")
        .select("id,agency_id,source_attachment_id,storage_path,status,payment_id")
        .eq("agency_id", agencyId)
        .eq("source_attachment_id", attachmentId)
        .maybeSingle();
      if (error) throw new Error(`Could not check Finance evidence: ${error.message}`);
      return data as FinanceEvidenceRecord | null;
    },
    async copyObject(source, destinationPath) {
      const download = await db.storage.from(INBOX_ATTACHMENT_BUCKET).download(source.sourceStoragePath);
      if (download.error || !download.data) throw new Error("The retained Inbox receipt could not be read");
      const bytes = new Uint8Array(await download.data.arrayBuffer());
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== source.checksumSha256.toLowerCase()) throw new Error("The retained Inbox receipt checksum does not match");
      const upload = await db.storage.from(FINANCE_EVIDENCE_BUCKET).upload(destinationPath, bytes, {
        contentType: source.mimeType,
        upsert: true,
      });
      if (upload.error) throw new Error(`Could not copy receipt into Finance: ${upload.error.message}`);
    },
    async insertEvidence(row) {
      const { data, error } = await db
        .from("finance_evidence_intake")
        .insert(row)
        .select("id,agency_id,source_attachment_id,storage_path,status,payment_id")
        .single();
      if (!error && data) return { row: data as FinanceEvidenceRecord, inserted: true };
      if (error?.code !== "23505") throw new Error(`Could not create Finance evidence: ${error?.message ?? "unknown error"}`);
      const { data: existing, error: existingError } = await db
        .from("finance_evidence_intake")
        .select("id,agency_id,source_attachment_id,storage_path,status,payment_id")
        .eq("agency_id", row.agency_id)
        .eq("source_attachment_id", row.source_attachment_id)
        .single();
      if (existingError || !existing) throw new Error("Concurrent Finance evidence could not be loaded");
      return { row: existing as FinanceEvidenceRecord, inserted: false };
    },
    async ensureAudit(row) {
      const { error } = await db.from("finance_activity_events").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Could not audit Finance evidence: ${error.message}`);
    },
    async listPendingEvidence(agencyId, limit) {
      const { data, error } = await db
        .from("finance_evidence_intake")
        .select("id,agency_id,candidate_amount,candidate_reference,candidate_date,booking_id,departure_group_id,source_conversation_id,source_message_id,created_at")
        .eq("agency_id", agencyId)
        .eq("status", "PENDING_REVIEW")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Could not list Finance evidence: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: String(row.id),
        agencyId: String(row.agency_id),
        amount: row.candidate_amount === null ? null : Number(row.candidate_amount),
        reference: (row.candidate_reference as string | null) ?? null,
        date: (row.candidate_date as string | null) ?? null,
        bookingId: (row.booking_id as string | null) ?? null,
        departureGroupId: (row.departure_group_id as string | null) ?? null,
        sourceConversationId: (row.source_conversation_id as string | null) ?? null,
        sourceMessageId: (row.source_message_id as string | null) ?? null,
        createdAt: String(row.created_at),
      }));
    },
    async listPaymentCandidates(agencyId, evidence) {
      const amounts = [...new Set(evidence.flatMap((item) => (item.amount === null ? [] : [item.amount])))];
      const references = [...new Set(evidence.flatMap((item) => (item.reference === null ? [] : [item.reference])))];
      const bookingIds = [...new Set(evidence.flatMap((item) => (item.bookingId === null ? [] : [item.bookingId])))];
      // Separate `.in()` filters (never a composed `.or()` string) so untrusted
      // receipt text can't alter the query shape. Reference lookups are raw
      // equality; differently formatted references still surface through the
      // amount lookup and are then compared normalised in the matcher.
      const columns = "id,agency_id,payment_reference,reference_number,amount,currency,paid_at,status,booking_id,departure_group_id,reverses_payment_id";
      const base = () => db
        .from("payments")
        .select(columns)
        .eq("agency_id", agencyId)
        .in("status", ["COMPLETED", "PENDING_VERIFICATION"])
        .is("reverses_payment_id", null)
        .limit(500);
      const lookups = [
        amounts.length ? base().in("amount", amounts) : null,
        references.length ? base().in("payment_reference", references) : null,
        references.length ? base().in("reference_number", references) : null,
        bookingIds.length ? base().in("booking_id", bookingIds) : null,
      ].filter((lookup) => lookup !== null);
      const results = await Promise.all(lookups);
      const byId = new Map<string, AgencyScopedEvidencePayment>();
      for (const { data, error } of results) {
        if (error) throw new Error(`Could not load payment candidates: ${error.message}`);
        for (const row of data ?? []) {
          byId.set(String(row.id), {
            agencyId: String(row.agency_id),
            paymentId: String(row.id),
            paymentReference: String(row.payment_reference),
            referenceNumber: (row.reference_number as string | null) ?? null,
            amount: Number(row.amount),
            currency: String(row.currency),
            paidAt: String(row.paid_at),
            status: String(row.status),
            bookingId: String(row.booking_id),
            departureGroupId: String(row.departure_group_id),
            reversesPaymentId: (row.reverses_payment_id as string | null) ?? null,
          });
        }
      }
      return [...byId.values()];
    },
    async findLinkedPaymentIds(agencyId, paymentIds) {
      if (paymentIds.length === 0) return new Set<string>();
      const { data, error } = await db
        .from("finance_evidence_intake")
        .select("payment_id")
        .eq("agency_id", agencyId)
        .in("payment_id", [...paymentIds]);
      if (error) throw new Error(`Could not check linked payments: ${error.message}`);
      return new Set((data ?? []).map((row) => String(row.payment_id)));
    },
    async loadPaymentForReview(agencyId, paymentId) {
      const { data, error } = await db
        .from("payments")
        .select("id,agency_id,payment_reference,reference_number,amount,currency,paid_at,status,booking_id,departure_group_id,reverses_payment_id")
        .eq("agency_id", agencyId)
        .eq("id", paymentId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the payment: ${error.message}`);
      if (!data) return null;
      return {
        agencyId: String(data.agency_id),
        paymentId: String(data.id),
        paymentReference: String(data.payment_reference),
        referenceNumber: (data.reference_number as string | null) ?? null,
        amount: Number(data.amount),
        currency: String(data.currency),
        paidAt: String(data.paid_at),
        status: String(data.status),
        bookingId: String(data.booking_id),
        departureGroupId: String(data.departure_group_id),
        reversesPaymentId: (data.reverses_payment_id as string | null) ?? null,
      };
    },
    async loadEvidenceForReview(agencyId, evidenceId) {
      const { data, error } = await db
        .from("finance_evidence_intake")
        .select("id,agency_id,status,payment_id,candidate_amount,candidate_reference,candidate_date,booking_id,departure_group_id,source_conversation_id,source_message_id,created_at")
        .eq("agency_id", agencyId)
        .eq("id", evidenceId)
        .maybeSingle();
      if (error) throw new Error(`Could not load Finance evidence: ${error.message}`);
      if (!data) return null;
      return {
        id: String(data.id),
        agencyId: String(data.agency_id),
        status: data.status as ReviewableFinanceEvidence["status"],
        paymentId: (data.payment_id as string | null) ?? null,
        amount: data.candidate_amount === null ? null : Number(data.candidate_amount),
        reference: (data.candidate_reference as string | null) ?? null,
        date: (data.candidate_date as string | null) ?? null,
        bookingId: (data.booking_id as string | null) ?? null,
        departureGroupId: (data.departure_group_id as string | null) ?? null,
        sourceConversationId: (data.source_conversation_id as string | null) ?? null,
        sourceMessageId: (data.source_message_id as string | null) ?? null,
        createdAt: String(data.created_at),
      };
    },
    async recordReview(row) {
      // Conditional on PENDING_REVIEW so two reviewers cannot both decide one item.
      const { data, error } = await db
        .from("finance_evidence_intake")
        .update({
          status: row.status,
          payment_id: row.paymentId,
          reviewed_by: row.actor.id,
          reviewed_by_name: row.actor.name,
          reviewed_at: row.reviewedAt,
          review_note: row.note,
        })
        .eq("agency_id", row.agencyId)
        .eq("id", row.evidenceId)
        .eq("status", "PENDING_REVIEW")
        .select("id");
      if (error) throw new Error(`Could not record the Finance review: ${error.message}`);
      return { applied: (data ?? []).length > 0 };
    },
    async ensureReviewAudit(row) {
      const { error } = await db.from("finance_activity_events").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Could not audit the Finance review: ${error.message}`);
    },
  });
}
