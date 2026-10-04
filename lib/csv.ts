/**
 * Generic, client-safe CSV primitives.
 *
 * The parser is a small state machine rather than a `split(",")`, so quoted
 * fields containing commas, quotes and newlines survive a round trip. Every
 * CSV export in the app (Departure Groups, Documents, Leads, Operations,
 * Suppliers, Settings, Team) goes through `toCsv()` here — do not add another
 * local copy.
 */

/**
 * A field starting with `= + - @` (or a tab/CR, which some parsers treat the
 * same way) is a formula in Excel/Sheets/LibreOffice once the file is
 * opened — free text like a lead's name or a supplier's note can carry one by
 * accident or on purpose, and the exporting user is rarely the one who typed
 * it. Prefixing with a single quote defuses it: spreadsheet apps show the
 * quote-stripped literal text instead of evaluating it, while the value is
 * unchanged for every other consumer of the CSV.
 */
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;

/** Quotes a field only when it needs it, doubling any embedded quotes. */
function encodeField(value: string): string {
  const safe = FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(rows: string[][]): string {
  // Excel only detects UTF-8 with a BOM; without it, Tamil and Sinhala names
  // and the "→" in package titles render as mojibake.
  return "﻿" + rows.map((row) => row.map(encodeField).join(",")).join("\r\n");
}

/**
 * Parses CSV text into a row/column matrix. Handles `""` escapes, quoted
 * newlines and both `\n` and `\r\n` line endings. Blank lines are dropped so a
 * file ending in a newline does not yield a phantom empty row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

/** Triggers a browser download of `text`. Client-side only. */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the click a tick to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampedFilename(prefix: string, extension = "csv"): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${prefix}-${stamp}.${extension}`;
}
