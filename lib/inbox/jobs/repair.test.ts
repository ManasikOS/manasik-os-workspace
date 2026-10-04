import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { repairMissingEnrichJobs, repairMissingMediaJobs } = await import("./repair");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTACHMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MESSAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function mediaDb(analysis: { kind: string; status: string } | null, rpc = vi.fn(async () => ({ data: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", error: null }))) {
  const chain = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "lt", "gt", "in"]) builder[name] = () => builder;
    builder.limit = async () => ({ data: rows, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
    return builder;
  };
  return {
    rpc,
    from: (table: string) => chain(table === "message_attachments" ? [{ id: ATTACHMENT, message_id: MESSAGE }] : analysis ? [{ attachment_id: ATTACHMENT, ...analysis }] : []),
  };
}

describe("repairMissingMediaJobs", () => {
  it("re-queues the download for a stored-nowhere attachment with the job kind its analysis needs", async () => {
    const rpc = vi.fn(async () => ({ data: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", error: null }));
    expect(await repairMissingMediaJobs(mediaDb({ kind: "VOICE", status: "PENDING" }, rpc) as never, AGENCY)).toBe(1);
    expect(rpc).toHaveBeenCalledWith("enqueue_channel_job", expect.objectContaining({ p_kind: "TRANSCRIBE_VOICE", p_coalesce_key: `media:${ATTACHMENT}` }));
  });

  it("does nothing for an attachment already read or without an analysis", async () => {
    const rpc = vi.fn();
    expect(await repairMissingMediaJobs(mediaDb({ kind: "OTHER", status: "READY" }, rpc as never) as never, AGENCY)).toBe(0);
    expect(await repairMissingMediaJobs(mediaDb(null, rpc as never) as never, AGENCY)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("repairMissingEnrichJobs", () => {
  it("asks the database to repair one agency with bounded defaults and returns the count", async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    expect(await repairMissingEnrichJobs({ rpc } as never, AGENCY)).toBe(3);
    expect(rpc).toHaveBeenCalledWith("repair_missing_enrich_jobs", { p_agency_id: AGENCY, p_older_than_seconds: 120, p_limit: 100 });
  });

  it("never throws: a failed repair reports zero and is left for the next tick", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await repairMissingEnrichJobs({ rpc: async () => ({ data: null, error: { message: "boom" } }) } as never, AGENCY)).toBe(0);
    expect(
      await repairMissingEnrichJobs({ rpc: async () => { throw new Error("network"); } } as never, AGENCY),
    ).toBe(0);
  });
});
