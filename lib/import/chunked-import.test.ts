import { describe, expect, it, vi } from "vitest";

import { IMPORT_MAX_ROWS_PER_CALL, importInChunks, type ChunkCallOutcome } from "./chunked-import";

interface Row { n: number }
interface Result { rowNumber: number; ok: boolean }

const shift = (r: Result, offset: number): Result => ({ ...r, rowNumber: r.rowNumber + offset });
const okChunk = async (chunk: Row[]): Promise<ChunkCallOutcome<Result>> => ({
  ok: true,
  results: chunk.map((_, i) => ({ rowNumber: i + 1, ok: true })),
});

describe("importInChunks", () => {
  it("splits rows into calls and numbers results across the whole file", async () => {
    const rows = Array.from({ length: 7 }, (_, n) => ({ n }));
    const sizes: number[] = [];
    const outcome = await importInChunks(rows, async (chunk) => { sizes.push(chunk.length); return okChunk(chunk); }, shift, { chunkSize: 3 });
    expect(sizes).toEqual([3, 3, 1]);
    expect(outcome.results.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(outcome).toMatchObject({ attempted: 7, total: 7, stoppedWith: null });
  });

  it("stops at a refused chunk and keeps what came before", async () => {
    const rows = Array.from({ length: 6 }, (_, n) => ({ n }));
    let call = 0;
    const outcome = await importInChunks(
      rows,
      async (chunk) => (++call === 2 ? { ok: false, error: "You have reached the limit." } : okChunk(chunk)),
      shift,
      { chunkSize: 2 },
    );
    expect(outcome.results).toHaveLength(2);
    expect(outcome).toMatchObject({ attempted: 2, total: 6, stoppedWith: "You have reached the limit." });
  });

  it("turns a thrown call into a stop, not a crash", async () => {
    const outcome = await importInChunks([{ n: 1 }], async () => { throw new Error("network"); }, shift);
    expect(outcome.stoppedWith).toMatch(/connection dropped/i);
    expect(outcome.attempted).toBe(0);
  });

  it("never sends more than the server cap per call, and reports progress", async () => {
    const rows = Array.from({ length: 120 }, (_, n) => ({ n }));
    const sizes: number[] = [];
    const onProgress = vi.fn();
    await importInChunks(rows, async (chunk) => { sizes.push(chunk.length); return okChunk(chunk); }, shift, { chunkSize: 500, onProgress });
    expect(Math.max(...sizes)).toBe(IMPORT_MAX_ROWS_PER_CALL);
    expect(onProgress).toHaveBeenLastCalledWith(120, 120);
  });

  it("handles an empty file", async () => {
    const outcome = await importInChunks<Row, Result>([], okChunk, shift);
    expect(outcome).toEqual({ results: [], attempted: 0, total: 0, stoppedWith: null });
  });
});
