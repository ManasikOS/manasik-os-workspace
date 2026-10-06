/**
 * Runs a bulk import as a series of small server calls instead of one long one.
 *
 * A single Server Action that creates up to 200 records, each with its own load
 * and write, runs for a long time and dies at the platform's time limit part way
 * through. Sending the file in chunks keeps every call short, lets the screen show
 * progress, and means a refusal (the usage limit, a lost session) stops the run at
 * a chunk boundary with everything before it already recorded and reported.
 *
 * Re-running a file is safe by itself: each created record has a unique
 * reference or code, so rows that already exist come back as ordinary
 * "already in use" failures rather than duplicates.
 *
 * Pure and generic so both import dialogs share it and it can be unit-tested.
 */

/** Rows sent per server call. The server accepts more; this keeps each call quick. */
export const IMPORT_ROWS_PER_CALL = 25;

/** Most rows one server call will accept, whatever the browser sends. */
export const IMPORT_MAX_ROWS_PER_CALL = 50;

export type ChunkCallOutcome<TResult> = { ok: true; results: TResult[] } | { ok: false; error: string };

export interface ChunkedImportOutcome<TResult> {
  /** Every row result received, numbered across the whole file. */
  results: TResult[];
  /** Rows actually sent before the run ended. */
  attempted: number;
  total: number;
  /** Set when a call was refused outright; the rows after it were not sent. */
  stoppedWith: string | null;
}

export async function importInChunks<TRow, TResult>(
  rows: readonly TRow[],
  sendChunk: (chunk: TRow[]) => Promise<ChunkCallOutcome<TResult>>,
  /** Row results are numbered from 1 within each call; this shifts them to the whole file. */
  shiftResult: (result: TResult, offset: number) => TResult,
  options: { chunkSize?: number; onProgress?: (attempted: number, total: number) => void } = {},
): Promise<ChunkedImportOutcome<TResult>> {
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? IMPORT_ROWS_PER_CALL, IMPORT_MAX_ROWS_PER_CALL));
  const results: TResult[] = [];
  let attempted = 0;

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    let outcome: ChunkCallOutcome<TResult>;
    try {
      outcome = await sendChunk(chunk);
    } catch {
      outcome = { ok: false, error: "The connection dropped. Check which rows were created, then import the rest." };
    }
    if (!outcome.ok) {
      return { results, attempted, total: rows.length, stoppedWith: outcome.error };
    }
    results.push(...outcome.results.map((result) => shiftResult(result, offset)));
    attempted += chunk.length;
    options.onProgress?.(attempted, rows.length);
  }

  return { results, attempted, total: rows.length, stoppedWith: null };
}
