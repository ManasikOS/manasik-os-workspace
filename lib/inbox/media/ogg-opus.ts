const OGG_CAPTURE_PATTERN = [79, 103, 103, 83] as const;
const OGG_HEADER_SIZE = 27;
const OGG_END_OF_STREAM = 0x04;
const OGG_CRC_POLYNOMIAL = 0x04_c1_1d_b7;

interface OggPage {
  offset: number;
  length: number;
}

function matchesAt(bytes: Uint8Array, offset: number, target: readonly number[]): boolean {
  return target.every((value, index) => bytes[offset + index] === value);
}

function readOggPages(bytes: Uint8Array): OggPage[] | null {
  const pages: OggPage[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + OGG_HEADER_SIZE > bytes.length || !matchesAt(bytes, offset, OGG_CAPTURE_PATTERN) || bytes[offset + 4] !== 0) return null;
    const segmentCount = bytes[offset + 26];
    const lacingStart = offset + OGG_HEADER_SIZE;
    if (lacingStart + segmentCount > bytes.length) return null;
    let bodyLength = 0;
    for (let index = 0; index < segmentCount; index += 1) bodyLength += bytes[lacingStart + index];
    const length = OGG_HEADER_SIZE + segmentCount + bodyLength;
    if (offset + length > bytes.length) return null;
    pages.push({ offset, length });
    offset += length;
  }
  return pages.length > 0 ? pages : null;
}

function oggChecksum(bytes: Uint8Array): number {
  let checksum = 0;
  for (const byte of bytes) {
    checksum ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum & 0x8000_0000) !== 0
        ? (checksum << 1) ^ OGG_CRC_POLYNOMIAL
        : checksum << 1;
    }
  }
  return checksum >>> 0;
}

function includesOpusHead(bytes: Uint8Array): boolean {
  return bytes.some((_value, offset) => matchesAt(bytes, offset, [79, 112, 117, 115, 72, 101, 97, 100]));
}

/**
 * WhatsApp occasionally supplies Ogg/Opus media without an EOS flag on its final audio page. Chromium then reports
 * a zero duration. Mark that page as EOS and recompute its CRC before retaining it. Older broken repairs appended an
 * empty EOS page; remove that page and repair the actual final audio page instead.
 */
export function finalizeOggOpusStream(source: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(source);
  const pages = readOggPages(bytes);
  if (!pages || !includesOpusHead(bytes)) return source;

  const trailingPage = pages.at(-1)!;
  const hasEmptyTerminalPage = trailingPage.length === OGG_HEADER_SIZE
    && bytes[trailingPage.offset + 26] === 0
    && (bytes[trailingPage.offset + 5] & OGG_END_OF_STREAM) !== 0;
  const audioPage = hasEmptyTerminalPage ? pages.at(-2) : trailingPage;
  if (!audioPage) return source;
  if (!hasEmptyTerminalPage && (bytes[audioPage.offset + 5] & OGG_END_OF_STREAM) !== 0) return source;

  const finalized = bytes.slice(0, hasEmptyTerminalPage ? trailingPage.offset : bytes.length);
  finalized[audioPage.offset + 5] |= OGG_END_OF_STREAM;
  finalized.fill(0, audioPage.offset + 22, audioPage.offset + 26);
  const finalizedPage = finalized.subarray(audioPage.offset, audioPage.offset + audioPage.length);
  new DataView(finalized.buffer).setUint32(audioPage.offset + 22, oggChecksum(finalizedPage), true);
  return finalized.buffer;
}
