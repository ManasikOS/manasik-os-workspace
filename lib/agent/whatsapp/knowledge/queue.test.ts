import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enqueueJob = vi.fn<(...args: unknown[]) => Promise<string>>(async () => "job-1");
vi.mock("@/lib/data/whatsapp-repository", () => ({ enqueueJob: (...args: unknown[]) => enqueueJob(...args) }));

const { queueKnowledgeIngest } = await import("./queue");
const db = {} as never;
const input = { agencyId: "agency-1", documentId: "doc-1" };

afterEach(() => {
  enqueueJob.mockClear();
});

describe("queueKnowledgeIngest", () => {
  it("queues the EMBED_DOCUMENT job for the agency and document", async () => {
    await queueKnowledgeIngest(db, input);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(db, { agencyId: "agency-1", kind: "EMBED_DOCUMENT", payload: { documentId: "doc-1" } });
  });

  it("lets a queueing failure reach the caller, so an upload is never reported as processed when nothing was queued", async () => {
    enqueueJob.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(queueKnowledgeIngest(db, input)).rejects.toThrow("database unavailable");
  });

  it("imports nothing from Inngest and reads no environment switch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "lib/agent/whatsapp/knowledge/queue.ts"), "utf8");
    expect(source).not.toMatch(/from "[^"]*inngest[^"]*"/i);
    expect(source).not.toContain("process.env");
  });
});
