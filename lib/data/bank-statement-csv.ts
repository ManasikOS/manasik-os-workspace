/**
 * Bank statement CSV parsing, kept pure so it can be unit-tested without the
 * Next server runtime — mirrors how `departure-groups-copy.ts` is separated
 * from `departure-groups-repository.ts` (which carries the `server-only`
 * guard `reconciliation-repository.ts` needs for its Supabase reads/writes).
 */

export interface ParsedBankLine {
  statementDate: string;
  description: string;
  reference: string | null;
  amount: number;
}

export interface ParseBankStatementResult {
  rows: ParsedBankLine[];
  errors: string[];
}

function splitCsvLine(line: string): string[] {
  // Simple quoted-field CSV split — good enough for a bank export's plain
  // date/description/reference/amount columns, not a general CSV parser.
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const DATE_HEADERS = new Set(["date", "statement date", "value date", "transaction date"]);
const DESCRIPTION_HEADERS = new Set(["description", "narrative", "details", "particulars"]);
const REFERENCE_HEADERS = new Set(["reference", "ref", "cheque no", "reference no"]);
const AMOUNT_HEADERS = new Set(["amount"]);
const CREDIT_HEADERS = new Set(["credit", "credit amount", "deposit"]);
const DEBIT_HEADERS = new Set(["debit", "debit amount", "withdrawal"]);

function toIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  // yyyy-mm-dd passes straight through; dd/mm/yyyy (the common bank export
  // shape) is the one other format worth handling without a date library.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses a pasted bank statement export. Accepts either a single signed
 * `amount` column, or separate `credit`/`debit` columns — both shapes are
 * common exports from a bank's own online portal. The header row decides
 * which columns are present; column order does not matter.
 */
export function parseBankStatementCsv(text: string): ParseBankStatementResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], errors: ["Paste at least a header row and one line."] };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateIdx = header.findIndex((h) => DATE_HEADERS.has(h));
  const descIdx = header.findIndex((h) => DESCRIPTION_HEADERS.has(h));
  const refIdx = header.findIndex((h) => REFERENCE_HEADERS.has(h));
  const amountIdx = header.findIndex((h) => AMOUNT_HEADERS.has(h));
  const creditIdx = header.findIndex((h) => CREDIT_HEADERS.has(h));
  const debitIdx = header.findIndex((h) => DEBIT_HEADERS.has(h));

  const errors: string[] = [];
  if (dateIdx === -1) errors.push('No "date" column found.');
  if (descIdx === -1) errors.push('No "description" column found.');
  if (amountIdx === -1 && creditIdx === -1 && debitIdx === -1) {
    errors.push('No "amount" column (or "credit"/"debit" pair) found.');
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: ParsedBankLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const lineNo = i + 1;

    const isoDate = toIsoDate(cells[dateIdx] ?? "");
    if (!isoDate) {
      errors.push(`Line ${lineNo}: could not read the date "${cells[dateIdx] ?? ""}".`);
      continue;
    }

    const description = (cells[descIdx] ?? "").trim();
    if (!description) {
      errors.push(`Line ${lineNo}: missing a description.`);
      continue;
    }

    let amount: number | null;
    if (amountIdx !== -1) {
      amount = toAmount(cells[amountIdx] ?? "");
    } else {
      const credit = creditIdx !== -1 ? (toAmount(cells[creditIdx] ?? "") ?? 0) : 0;
      const debit = debitIdx !== -1 ? (toAmount(cells[debitIdx] ?? "") ?? 0) : 0;
      amount = credit !== 0 ? Math.abs(credit) : debit !== 0 ? -Math.abs(debit) : 0;
    }
    if (amount === null || amount === 0) {
      errors.push(`Line ${lineNo}: could not read an amount.`);
      continue;
    }

    rows.push({
      statementDate: isoDate,
      description,
      reference: refIdx !== -1 ? (cells[refIdx] ?? "").trim() || null : null,
      amount,
    });
  }

  return { rows, errors };
}
