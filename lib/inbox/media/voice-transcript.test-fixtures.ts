/** Builders for tiny synthetic Ogg Opus streams, used only by tests. */

export function oggPage(input: { headerType?: number; granule: bigint; sequence: number; data: Uint8Array }): Uint8Array {
  const header = new Uint8Array(27 + 1);
  header.set([0x4f, 0x67, 0x67, 0x53, 0, input.headerType ?? 0]);
  new DataView(header.buffer).setBigInt64(6, input.granule, true);
  new DataView(header.buffer).setUint32(18, input.sequence, true);
  header[26] = 1;
  header[27] = input.data.length;
  const page = new Uint8Array(header.length + input.data.length);
  page.set(header);
  page.set(input.data, header.length);
  return page;
}

export function opusHead(preSkip: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  new DataView(head.buffer).setUint16(10, preSkip, true);
  return head;
}

export function concat(...parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}

/** A readable Ogg Opus stream that reports `seconds` of audio. */
export function oggOpusFixture(seconds: number): ArrayBuffer {
  return concat(
    oggPage({ headerType: 2, granule: BigInt(0), sequence: 0, data: opusHead(0) }),
    oggPage({ headerType: 4, granule: BigInt(seconds) * BigInt(48_000), sequence: 1, data: new Uint8Array(20) }),
  );
}
