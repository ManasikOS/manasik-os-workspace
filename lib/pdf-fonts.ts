/**
 * Character widths for the two standard PDF Type1 fonts this app uses —
 * Helvetica and Helvetica-Bold. These are part of the 14 standard fonts
 * every PDF-conformant viewer ships, so `lib/pdf.ts` never embeds font
 * data, only references `/BaseFont /Helvetica`. The widths (Adobe's public
 * AFM metrics, in 1/1000 em) are still needed client-side to lay text out —
 * right-align a money column, wrap a description — before the PDF is built.
 *
 * Covers the printable ASCII range (32–126), which is everything an English
 * invoice needs. A character outside that range falls back to 556 (roughly
 * Helvetica's average).
 */

const HELVETICA_WIDTHS: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015,
  65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722,
  73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667,
  81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667,
  89: 667, 90: 611,
  91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333,
  97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500,
  123: 334, 124: 260, 125: 334, 126: 584,
};

const HELVETICA_BOLD_WIDTHS: Record<number, number> = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584, 62: 584, 63: 611,
  64: 975,
  65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722,
  73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667,
  81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667,
  89: 667, 90: 611,
  91: 333, 92: 278, 93: 333, 94: 584, 95: 556, 96: 333,
  97: 556, 98: 611, 99: 556, 100: 611, 101: 556, 102: 333, 103: 611,
  104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611,
  118: 556, 119: 778, 120: 556, 121: 556, 122: 500,
  123: 389, 124: 280, 125: 389, 126: 584,
};

export type PdfFontName = "Helvetica" | "Helvetica-Bold";

const FALLBACK_WIDTH = 556;

function widthTable(font: PdfFontName): Record<number, number> {
  return font === "Helvetica-Bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
}

/** Width of one string at `fontSize`, in points. */
export function textWidth(
  text: string,
  font: PdfFontName,
  fontSize: number,
): number {
  const table = widthTable(font);
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    units += table[code] ?? FALLBACK_WIDTH;
  }
  return (units / 1000) * fontSize;
}

/**
 * Greedy word-wrap: splits `text` into lines that each fit within
 * `maxWidth` points at `fontSize`. A single word longer than `maxWidth` is
 * placed on its own line rather than broken mid-word.
 */
export function wrapText(
  text: string,
  font: PdfFontName,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, font, fontSize) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
