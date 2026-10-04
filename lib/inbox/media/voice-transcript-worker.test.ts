import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createVoiceTranscriptWorker,
  type VoiceTranscriptRow,
  type VoiceTranscriptSettlement,
  type VoiceTranscriptWorkerDependencies,
} from "./voice-transcript-worker";
import { oggOpusFixture } from "./voice-transcript.test-fixtures";

const AGENCY = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";

const speech = { hasSpeech: true, transcript: "Salaam, two seats please.", language: "en" as const, confidence: 0.92 };

function world(overrides: Partial<VoiceTranscriptWorkerDependencies> = {}, initial: Partial<VoiceTranscriptRow> = {}) {
  const rows = new Map<string, VoiceTranscriptRow>();
  const settlements: VoiceTranscriptSettlement[] = [];
  const logs: Record<string, unknown>[] = [];
  const transcribe = vi.fn(async () => ({ ok: true as const, value: speech, model: "model-x", runId: "run-1", latencyMs: 1200 }));
  const dependencies: VoiceTranscriptWorkerDependencies = {
    store: {
      async ensure(key) {
        const id = `${key.agencyId}:${key.attachmentId}`;
        if (!rows.has(id)) rows.set(id, { status: "PENDING", attemptCount: 0, ...initial });
        return rows.get(id)!;
      },
      async markProcessing(key) {
        const row = rows.get(`${key.agencyId}:${key.attachmentId}`)!;
        if (row.status !== "PENDING" && row.status !== "PROCESSING") return false;
        rows.set(`${key.agencyId}:${key.attachmentId}`, { ...row, status: "PROCESSING", attemptCount: row.attemptCount + 1 });
        return true;
      },
      async settle(key, settlement) {
        const row = rows.get(`${key.agencyId}:${key.attachmentId}`)!;
        if (row.status !== "PENDING" && row.status !== "PROCESSING") return false;
        settlements.push(settlement);
        rows.set(`${key.agencyId}:${key.attachmentId}`, { ...row, status: settlement.status });
        return true;
      },
      async releaseForRetry(key) {
        const row = rows.get(`${key.agencyId}:${key.attachmentId}`)!;
        rows.set(`${key.agencyId}:${key.attachmentId}`, { ...row, status: "PENDING" });
      },
    },
    isEnabled: async () => true,
    transcribe,
    now: () => new Date("2026-10-01T00:00:00Z"),
    log: (fields) => logs.push({ ...fields }),
    ...overrides,
  };
  return { worker: createVoiceTranscriptWorker(dependencies), rows, settlements, logs, transcribe };
}

const input = (overrides = {}) => ({
  agencyId: AGENCY,
  attachmentId: ATTACHMENT,
  messageId: MESSAGE,
  mimeType: "audio/ogg",
  bytes: new ArrayBuffer(2048),
  isFinalAttempt: false,
  ...overrides,
});

describe("voice transcript worker", () => {
  it("transcribes an eligible voice note and settles it complete", async () => {
    const { worker, settlements, transcribe } = world();
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "COMPLETE" });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(settlements[0]).toMatchObject({
      status: "COMPLETE",
      transcriptText: "Salaam, two seats please.",
      language: "en",
      confidence: 0.92,
      model: "model-x",
      completedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("settles a low-confidence transcript as LOW_CONFIDENCE without discarding it", async () => {
    const { worker, settlements } = world({
      transcribe: async () => ({ ok: true, value: { ...speech, confidence: 0.4 }, model: "m", runId: null, latencyMs: 10 }),
    });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "LOW_CONFIDENCE" });
    expect(settlements[0]).toMatchObject({ status: "LOW_CONFIDENCE", transcriptText: "Salaam, two seats please." });
  });

  it("records NO_SPEECH as a terminal failure", async () => {
    const { worker, settlements } = world({
      transcribe: async () => ({ ok: true, value: { hasSpeech: false, transcript: "", language: "en", confidence: 0.9 }, model: "m", runId: null, latencyMs: 10 }),
    });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "FAILED" });
    expect(settlements[0]).toMatchObject({ status: "FAILED", failureReason: "NO_SPEECH", transcriptText: null });
  });

  it("is idempotent: a finished transcript is never sent to the provider again", async () => {
    const { worker, transcribe } = world();
    await worker.run(input());
    await worker.run(input());
    await worker.run(input());
    expect(transcribe).toHaveBeenCalledOnce();
  });

  it("does not re-run a note that was already skipped or failed", async () => {
    for (const status of ["SKIPPED", "FAILED", "LOW_CONFIDENCE"] as const) {
      const { worker, transcribe } = world({}, { status });
      await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status });
      expect(transcribe).not.toHaveBeenCalled();
    }
  });

  it("checks entitlement before any provider use and skips as DISABLED", async () => {
    const { worker, settlements, transcribe } = world({ isEnabled: async () => false });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "SKIPPED" });
    expect(transcribe).not.toHaveBeenCalled();
    expect(settlements[0]).toMatchObject({ status: "SKIPPED", failureReason: "DISABLED" });
  });

  it("skips unsupported, oversized and over-long notes before any provider use", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ mimeType: "audio/amr" }, "UNSUPPORTED_FORMAT"],
      [{ bytes: new ArrayBuffer(10 * 1024 * 1024 + 1) }, "TOO_LARGE"],
    ];
    for (const [override, reason] of cases) {
      const { worker, settlements, transcribe } = world();
      await worker.run(input(override));
      expect(transcribe).not.toHaveBeenCalled();
      expect(settlements[0]).toMatchObject({ status: "SKIPPED", failureReason: reason });
    }
    const { worker, settlements, transcribe } = world();
    await worker.run(input({ durationSeconds: 301 }));
    expect(transcribe).not.toHaveBeenCalled();
    expect(settlements[0]).toMatchObject({ failureReason: "TOO_LONG" });
  });

  it("skips as QUOTA_EXCEEDED when the provider seam reports the allowance is spent", async () => {
    const { worker, settlements } = world({ transcribe: async () => ({ ok: false, reason: "QUOTA_EXCEEDED", note: "spent" }) });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "SKIPPED" });
    expect(settlements[0]).toMatchObject({ status: "SKIPPED", failureReason: "QUOTA_EXCEEDED" });
  });

  it("maps a provider-side switch-off to a DISABLED skip", async () => {
    const { worker, settlements } = world({ transcribe: async () => ({ ok: false, reason: "DISABLED", note: "off" }) });
    await worker.run(input());
    expect(settlements[0]).toMatchObject({ status: "SKIPPED", failureReason: "DISABLED" });
  });

  it("asks for a retry on a transient provider failure and leaves the row pending", async () => {
    const { worker, rows, settlements } = world({ transcribe: async () => ({ ok: false, reason: "PROVIDER_ERROR", note: "502" }) });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "RETRY", status: "PENDING" });
    expect(settlements).toEqual([]);
    expect([...rows.values()][0]).toMatchObject({ status: "PENDING", attemptCount: 1 });
  });

  it("settles a transient failure as FAILED only on the final attempt", async () => {
    const { worker, settlements } = world({ transcribe: async () => ({ ok: false, reason: "TIMEOUT", note: "slow" }) });
    await expect(worker.run(input({ isFinalAttempt: true }))).resolves.toEqual({ outcome: "DONE", status: "FAILED" });
    expect(settlements[0]).toMatchObject({ status: "FAILED", failureReason: "TIMEOUT", transcriptText: null });
  });

  it("stops quietly when another worker already settled the row", async () => {
    const { worker, settlements } = world({
      store: {
        ensure: async () => ({ status: "PENDING", attemptCount: 0 }),
        markProcessing: async () => false,
        settle: async () => false,
        releaseForRetry: async () => undefined,
      },
    });
    await expect(worker.run(input())).resolves.toEqual({ outcome: "DONE", status: "PROCESSING" });
    expect(settlements).toEqual([]);
  });

  it("derives the duration of an Ogg Opus note when the caller does not know it", async () => {
    const { worker, transcribe } = world();
    await worker.run(input());
    expect(transcribe).toHaveBeenCalledOnce();
    const { worker: tooLong, settlements } = world();
    const stream = oggOpusFixture(400);
    await tooLong.run(input({ bytes: stream }));
    expect(settlements[0]).toMatchObject({ status: "SKIPPED", failureReason: "TOO_LONG" });
  });

  it("logs outcome fields without transcript content", async () => {
    const { worker, logs } = world();
    await worker.run(input());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ agencyId: AGENCY, attachmentId: ATTACHMENT, status: "COMPLETE", failureReason: null, model: "model-x", latencyMs: 1200, attempt: 1 });
    expect(JSON.stringify(logs)).not.toContain("two seats");
    expect(JSON.stringify(logs)).not.toContain("Salaam");
  });
});
