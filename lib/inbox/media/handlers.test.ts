import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LaneJobContext } from "@/lib/inbox/jobs/drain";
import type { ClaimedChannelJob } from "@/lib/inbox/jobs/queue";
import { createMediaJobHandler, type MediaHandlerDependencies } from "./handlers";

const AGENCY = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";

function job(kind: ClaimedChannelJob["kind"], attempts = 1, maxAttempts = 3): ClaimedChannelJob {
  return { id: "55555555-5555-4555-8555-555555555555", agencyId: AGENCY, lane: "BULK", kind, coalesceKey: null, payload: { attachmentId: ATTACHMENT, messageId: MESSAGE }, attempts, maxAttempts, workerId: "test" };
}

const context = { db: {} as LaneJobContext["db"], signal: new AbortController().signal, deadlineMs: Date.now() + 10_000 };
const retained = { bytes: new ArrayBuffer(8), mimeType: "image/jpeg", conversationId: CONVERSATION };
const createEnabledMediaHandler = (overrides: Partial<MediaHandlerDependencies> = {}) => createMediaJobHandler({ isMediaIntelligenceEnabled: async () => true, ...overrides });

describe("media BULK handlers", () => {
  it("retains the original voice note and marks it ready before any transcription is attempted", async () => {
    const order: string[] = [];
    const loadAndRetain = vi.fn(async () => ({ ...retained, mimeType: "audio/ogg" }));
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => { order.push("update"); });
    const transcribeVoice = vi.fn<MediaHandlerDependencies["transcribeVoice"]>(async () => { order.push("transcribe"); return { outcome: "DONE", status: "COMPLETE" }; });
    const handler = createEnabledMediaHandler({ loadAndRetain, update, transcribeVoice });

    await handler(job("TRANSCRIBE_VOICE"), context);

    expect(loadAndRetain).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(context, expect.anything(), expect.objectContaining({
      kind: "VOICE",
      status: "READY",
      candidate_fields: {},
      transcript: null,
      source_model: null,
    }));
    expect(order).toEqual(["update", "transcribe"]);
    expect(transcribeVoice).toHaveBeenCalledWith(context, expect.objectContaining({ id: expect.any(String) }), expect.objectContaining({ mimeType: "audio/ogg" }), false);
  });

  it("never writes transcript text into the shared media analysis or the customer message", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => ({ ...retained, mimeType: "audio/ogg" })),
      update,
      transcribeVoice: vi.fn(async () => ({ outcome: "DONE" as const, status: "COMPLETE" as const })),
    });
    await handler(job("TRANSCRIBE_VOICE"), context);
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0][2] as Record<string, unknown>).transcript).toBeNull();
  });

  it("asks the lane to retry when transcription hits a transient failure, without failing playback", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => ({ ...retained, mimeType: "audio/ogg" })),
      update,
      transcribeVoice: vi.fn(async () => ({ outcome: "RETRY" as const, status: "PENDING" as const })),
    });
    await expect(handler(job("TRANSCRIBE_VOICE", 1, 3), context)).rejects.toThrow("retried");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalledWith(context, expect.anything(), expect.objectContaining({ status: "FAILED" }));
  });

  it("keeps the voice note ready when transcription breaks unexpectedly on the final attempt", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => ({ ...retained, mimeType: "audio/ogg" })),
      update,
      transcribeVoice: vi.fn(async () => { throw new Error("database unreachable"); }),
    });
    await expect(handler(job("TRANSCRIBE_VOICE", 3, 3), context)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalledWith(context, expect.anything(), expect.objectContaining({ status: "FAILED" }));
  });

  it("retries an unexpected transcription error while attempts remain", async () => {
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => ({ ...retained, mimeType: "audio/ogg" })),
      update: vi.fn(async () => undefined),
      transcribeVoice: vi.fn(async () => { throw new Error("database unreachable"); }),
    });
    await expect(handler(job("TRANSCRIBE_VOICE", 1, 3), context)).rejects.toThrow("database unreachable");
  });

  it("routes a receipt to Finance review and never writes payment state", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const openReview = vi.fn(async () => "66666666-6666-4666-8666-666666666666");
    const extract: MediaHandlerDependencies["extract"] = async () => ({ kind: "RECEIPT", confidence: 0.96, passportNumber: null, expiryDate: null, fullName: null, amount: 1250, reference: "TX-10", paidAt: "2026-09-20", summary: null });
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => retained),
      extract: vi.fn(extract),
      update,
      openReview,
    });

    await handler(job("EXTRACT_RECEIPT"), context);

    expect(openReview).toHaveBeenCalledWith(context, expect.anything(), CONVERSATION, "PAYMENT_CLAIM_UNVERIFIED");
    const written = update.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(written).toMatchObject({ kind: "RECEIPT", status: "REVIEW_REQUIRED", intervention_id: "66666666-6666-4666-8666-666666666666" });
    expect(JSON.stringify(written)).not.toMatch(/payment_status|payment_state|confirmed/i);
  });

  it("marks low-confidence passport fields and opens an expiry review", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const openReview = vi.fn(async () => "77777777-7777-4777-8777-777777777777");
    const extract: MediaHandlerDependencies["extract"] = async () => ({ kind: "PASSPORT", confidence: 0.72, passportNumber: "N123", expiryDate: "2025-01-01", fullName: "Test Traveller", amount: null, reference: null, paidAt: null, summary: null });
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => retained),
      extract: vi.fn(extract),
      update,
      openReview,
      loadContext: vi.fn(async () => ({ leadId: "lead-1", bookingId: "booking-1", travellers: [{ id: "traveller-1", fullName: "Test Traveller", passportNumber: "N123" }], departureDate: "2026-12-01", departureGroupId: null, passportValidityMonths: 6 })),
      now: () => new Date("2026-09-22T00:00:00Z"),
    });

    await handler(job("READ_DOCUMENT"), context);

    expect(openReview).toHaveBeenCalledWith(context, expect.anything(), CONVERSATION, "PASSPORT_EXPIRY_RISK");
    expect(update).toHaveBeenCalledWith(context, expect.anything(), expect.objectContaining({
      kind: "PASSPORT",
      status: "REVIEW_REQUIRED",
      uncertainty: ["passportNumber", "expiryDate", "fullName"],
    }));
  });

  it("opens one existing passport review for an ambiguous attachment instead of selecting a traveller", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const openPassportReview = vi.fn(async () => "77777777-7777-4777-8777-777777777777");
    const handler = createEnabledMediaHandler({
      loadAndRetain: vi.fn(async () => retained),
      extract: vi.fn<MediaHandlerDependencies["extract"]>(async () => ({ kind: "PASSPORT", confidence: 0.99, passportNumber: null, expiryDate: "2028-01-01", fullName: null, amount: null, reference: null, paidAt: null, summary: null })),
      update,
      openPassportReview,
      loadContext: vi.fn(async () => ({ leadId: "lead-1", bookingId: "booking-1", travellers: [{ id: "traveller-1", fullName: "Aisha", passportNumber: "N1" }, { id: "traveller-2", fullName: "Fatima", passportNumber: "N2" }], departureDate: "2026-12-01", departureGroupId: null, passportValidityMonths: 6 })),
    });

    await handler(job("READ_DOCUMENT"), context);

    expect(openPassportReview).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(context, expect.anything(), expect.objectContaining({
      selected_traveller_id: null,
      candidate_traveller_ids: ["traveller-1", "traveller-2"],
      review_fields: expect.objectContaining({ travellerSelectionRequired: true }),
    }));
  });

  it("marks the analysis failed only when the job exhausts its retries", async () => {
    const update = vi.fn<MediaHandlerDependencies["update"]>(async () => undefined);
    const handler = createEnabledMediaHandler({ loadAndRetain: vi.fn(async () => { throw new Error("provider file expired"); }), update });

    await expect(handler(job("READ_DOCUMENT", 3, 3), context)).rejects.toThrow("provider file expired");
    expect(update).toHaveBeenCalledWith(context, expect.anything(), { status: "FAILED", uncertainty: ["provider file expired"] });
  });

  it("retains the original but refuses premium analysis when the plan disables it", async () => {
    const extract = vi.fn<MediaHandlerDependencies["extract"]>();
    const update = vi.fn(async () => undefined);
    const handler = createMediaJobHandler({ loadAndRetain: vi.fn(async () => retained), extract, update, isMediaIntelligenceEnabled: async () => false });
    await handler(job("READ_DOCUMENT"), context);
    expect(extract).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(context, expect.anything(), { status: "READY", candidate_fields: {}, uncertainty: [] });
  });

  it("marks a file the reading model cannot open as ready instead of failing it", async () => {
    const extract = vi.fn<MediaHandlerDependencies["extract"]>();
    const update = vi.fn(async () => undefined);
    const handler = createEnabledMediaHandler({ loadAndRetain: vi.fn(async () => ({ ...retained, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })), extract, update });
    await handler(job("READ_DOCUMENT"), context);
    expect(extract).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(context, expect.anything(), { status: "READY", candidate_fields: {}, uncertainty: [] });
  });
});
