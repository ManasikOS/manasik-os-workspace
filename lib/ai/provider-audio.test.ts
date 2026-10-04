import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const checkBudget = vi.fn();
vi.mock("@/lib/ai/budget", () => ({ checkBudget: (...args: unknown[]) => checkBudget(...args) }));
const recordAiRun = vi.fn(async () => "run-1");
vi.mock("@/lib/ai/telemetry", () => ({ recordAiRun: (...args: unknown[]) => recordAiRun(...(args as [])) }));

import { generateAudioTranscript, TRANSCRIBE_MODEL } from "./provider";

const schema = z.object({ text: z.string() }).strict();
const baseInput = {
  system: "system",
  instruction: "transcribe",
  audio: { bytes: new Uint8Array([1, 2, 3]).buffer, format: "ogg" as const },
  jsonSchema: { type: "object" },
  schema,
  surface: "inbox_voice_transcript",
  agencyId: "agency-1",
  subjectType: "message_attachment",
  subjectId: "attachment-1",
  db: {} as never,
};

function reply(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const okBody = { choices: [{ message: { content: JSON.stringify({ text: "hello" }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = "test-key";
  checkBudget.mockResolvedValue({ ok: true });
});

describe("generateAudioTranscript", () => {
  it("returns the validated value and records one metered run", async () => {
    const fetchImpl = reply(okBody);
    const result = await generateAudioTranscript({ ...baseInput, fetchImpl });
    expect(result).toMatchObject({ ok: true, value: { text: "hello" }, model: TRANSCRIBE_MODEL, runId: "run-1" });
    expect(recordAiRun).toHaveBeenCalledTimes(1);
    expect(recordAiRun.mock.calls[0]).toMatchObject([
      {},
      { agencyId: "agency-1", surface: "inbox_voice_transcript", subjectType: "message_attachment", subjectId: "attachment-1", model: TRANSCRIBE_MODEL, status: "OK", usage: { input: 100, output: 20 } },
    ]);
  });

  it("sends the audio as an input_audio part with strict JSON output and the bearer key", async () => {
    const fetchImpl = reply(okBody);
    await generateAudioTranscript({ ...baseInput, fetchImpl });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(TRANSCRIBE_MODEL);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "transcribe" },
      { type: "input_audio", input_audio: { data: "AQID", format: "ogg" } },
    ]);
  });

  it("does not call the provider when AI is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchImpl = reply(okBody);
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "DISABLED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses before the provider when the surface is switched off or the allowance is spent", async () => {
    const fetchImpl = reply(okBody);
    checkBudget.mockResolvedValueOnce({ ok: false, reason: "AI surface is turned off" });
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "DISABLED" });
    checkBudget.mockResolvedValueOnce({ ok: false, degradation: "DETERMINISTIC_ONLY", reason: "above 120%" });
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "QUOTA_EXCEEDED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an exhausted allowance as quota even though the budget gate would still allow it", async () => {
    checkBudget.mockResolvedValueOnce({ ok: true, degradation: "RULES_AND_MATCHING_ONLY" });
    const fetchImpl = reply(okBody);
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "QUOTA_EXCEEDED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider failures to retryable reasons and records the failed run without the audio or the reply", async () => {
    const fetchImpl = reply({ error: { message: "upstream blew up with the customer's words" } }, 502);
    const result = await generateAudioTranscript({ ...baseInput, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "PROVIDER_ERROR" });
    expect(recordAiRun.mock.calls[0]).toMatchObject([{}, { status: "MODEL_ERROR", usage: { input: 0, output: 0 } }]);
    expect(JSON.stringify(recordAiRun.mock.calls[0])).not.toContain("customer's words");
  });

  it("maps a timeout to TIMEOUT", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "TIMEOUT" });
  });

  it("rejects output that fails schema validation instead of trusting it", async () => {
    const fetchImpl = reply({ choices: [{ message: { content: JSON.stringify({ text: 5 }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "PROVIDER_ERROR" });
  });

  it("rejects non-JSON model output", async () => {
    const fetchImpl = reply({ choices: [{ message: { content: "sure, here you go" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    await expect(generateAudioTranscript({ ...baseInput, fetchImpl })).resolves.toMatchObject({ ok: false, reason: "PROVIDER_ERROR" });
  });
});
