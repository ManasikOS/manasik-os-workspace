import { describe, expect, it } from "vitest";

import { finalizeOggOpusStream } from "./ogg-opus";

function oggPage(input: { flags: number; granulePosition: number; serial: number; sequence: number; body: number[] }): number[] {
  const page = new Uint8Array(28 + input.body.length);
  page.set([79, 103, 103, 83, 0, input.flags]);
  new DataView(page.buffer).setUint32(6, input.granulePosition, true);
  new DataView(page.buffer).setUint32(14, input.serial, true);
  new DataView(page.buffer).setUint32(18, input.sequence, true);
  page[26] = 1;
  page[27] = input.body.length;
  page.set(input.body, 28);
  return [...page];
}

describe("finalizeOggOpusStream", () => {
  it("marks the final audio page as EOS so browsers can determine the voice note's duration", () => {
    const missingEos = new Uint8Array([
      ...oggPage({ flags: 2, granulePosition: 0, serial: 7, sequence: 0, body: [...new TextEncoder().encode("OpusHead")] }),
      ...oggPage({ flags: 0, granulePosition: 96_000, serial: 7, sequence: 1, body: [1, 2, 3] }),
    ]);

    const finalized = new Uint8Array(finalizeOggOpusStream(missingEos.buffer));

    expect(finalized).toHaveLength(missingEos.length);
    expect(finalized[missingEos.length - 26]).toBe(4);
    expect(new DataView(finalized.buffer, finalized.byteOffset + finalized.length - 25).getUint32(0, true)).toBe(96_000);
    expect(new DataView(finalized.buffer, finalized.byteOffset + finalized.length - 17).getUint32(0, true)).toBe(7);
    expect(new DataView(finalized.buffer, finalized.byteOffset + finalized.length - 13).getUint32(0, true)).toBe(1);
  });

  it("leaves complete and non-Opus files unchanged", () => {
    const complete = new Uint8Array([
      ...oggPage({ flags: 2, granulePosition: 0, serial: 7, sequence: 0, body: [...new TextEncoder().encode("OpusHead")] }),
      ...oggPage({ flags: 4, granulePosition: 96_000, serial: 7, sequence: 1, body: [1, 2, 3] }),
    ]);
    const other = new TextEncoder().encode("not an Ogg stream");

    expect(finalizeOggOpusStream(complete.buffer)).toBe(complete.buffer);
    expect(finalizeOggOpusStream(other.buffer)).toBe(other.buffer);
  });

  it("replaces a previously appended empty EOS page with EOS on the real audio page", () => {
    const audio = new Uint8Array([
      ...oggPage({ flags: 2, granulePosition: 0, serial: 7, sequence: 0, body: [...new TextEncoder().encode("OpusHead")] }),
      ...oggPage({ flags: 0, granulePosition: 48_000, serial: 7, sequence: 1, body: [1, 2, 3] }),
    ]);
    const emptyEos = new Uint8Array(27);
    emptyEos.set([79, 103, 103, 83, 0, 4]);
    const previouslyBroken = new Uint8Array(audio.length + emptyEos.length);
    previouslyBroken.set(audio);
    previouslyBroken.set(emptyEos, audio.length);

    const finalized = new Uint8Array(finalizeOggOpusStream(previouslyBroken.buffer));

    expect(finalized).toHaveLength(audio.length);
    expect(finalized[audio.length - 26]).toBe(4);
  });
});
