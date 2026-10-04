import { toCsv, parseCsv, downloadTextFile } from "@/lib/csv";
import {
  CURRENCY_LABELS,
  PAYMENT_TERMS_LABELS,
  PREFERRED_CHANNEL_LABELS,
  RELIABILITY_LABELS,
  SERVICE_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/data/suppliers-copy";
import type { CreateSupplierInput } from "@/lib/validations/suppliers";
import type { SupplierListItem } from "./types";

export { parseCsv, downloadTextFile };

/** Triggers a browser download of raw bytes (used for the .xlsx template). */
export function downloadBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function suppliersToCsv(items: SupplierListItem[]): string {
  const headers = [
    "Supplier Code",
    "Name",
    "Type",
    "Status",
    "Reliability",
    "City",
    "Country",
    "Service Categories",
    "Active Groups",
    "Confirmed",
    "Pending",
    "Issues",
    "Outstanding",
    "Currency",
    "Primary Contact",
    "WhatsApp",
  ];

  const rows = items.map((item) => [
    item.supplierCode,
    item.name,
    SUPPLIER_TYPE_LABELS[item.supplierType] ?? item.supplierType,
    item.status,
    RELIABILITY_LABELS[item.reliability] ?? item.reliability,
    item.city ?? "",
    item.country ?? "",
    item.serviceCategories.join("; "),
    String(item.activeGroupCount),
    String(item.confirmedCount),
    String(item.pendingCount),
    String(item.issueCount),
    String(item.outstandingAmount),
    item.currency,
    item.primaryContactName ?? "",
    item.primaryContactWhatsapp ?? "",
  ]);

  return toCsv([headers, ...rows]);
}

export function timestampedFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
}

/* ── Import ───────────────────────────────────────────────────────────────── */

/** Column keys the importer understands, in template order. */
export const IMPORT_COLUMNS = [
  "name",
  "supplier_code",
  "supplier_type",
  "service_categories",
  "status",
  "city",
  "country",
  "contact_name",
  "whatsapp",
  "email",
  "preferred_channel",
  "arabic_speaking",
  "currency",
  "payment_terms",
  "lead_time_days",
  "internal_notes",
] as const;

/** A starter template (header + one worked example row) as a string matrix. */
export function importTemplateMatrix(): string[][] {
  const header = [...IMPORT_COLUMNS];
  const sample = [
    "Al Noor Travel Services",
    "SUP-MAK-001",
    "Broker / Ground Handler",
    "Makkah Accommodation; Airport Transfer",
    "Active",
    "Makkah",
    "Saudi Arabia",
    "Ahmed Al Noor",
    "+966 5xx xxx xxxx",
    "contact@supplier.com",
    "WhatsApp",
    "true",
    "SAR",
    "Pay After Confirmation",
    "7",
    "Best for Makkah hotel availability during Ramadan.",
  ];
  return [header, sample];
}

/** The template as CSV text. */
export function importTemplateCsv(): string {
  return toCsv(importTemplateMatrix());
}

export interface SupplierImportCandidate {
  /** 1-based position among the data rows, for the preview and error messages. */
  rowNumber: number;
  name: string;
  supplierCode: string;
  /** Best-effort payload; may still fail schema validation downstream. */
  payload: CreateSupplierInput;
  /** Structural problems the Zod schema cannot express (e.g. unknown enum label). */
  mappingErrors: string[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Accepts both the enum code (`BROKER`) and its human label. */
function normalizeEnum(
  raw: string,
  labels: Record<string, string>,
): string | null {
  const value = raw.trim();
  if (!value) return null;
  const upper = value.toUpperCase().replace(/\s+/g, "_");
  if (upper in labels) return upper;
  const byLabel = Object.entries(labels).find(
    ([, label]) => label.toLowerCase() === value.toLowerCase(),
  );
  return byLabel ? byLabel[0] : null;
}

function normalizeCategories(raw: string): {
  categories: string[];
  unknown: string[];
} {
  const parts = raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const categories: string[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    const match = normalizeEnum(part, SERVICE_CATEGORY_LABELS);
    if (match) categories.push(match);
    else unknown.push(part);
  }
  return { categories, unknown };
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "") return fallback;
  return ["true", "yes", "y", "1"].includes(value);
}

function parseInteger(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Maps parsed spreadsheet rows to `createSupplierAction` payloads. Returns one
 * candidate per data row, with any structural problems (unrecognised enum
 * labels) collected in `mappingErrors`; full field validation is left to
 * `createSupplierSchema` so the rules stay in one place.
 */
export function buildSupplierImportCandidates(rows: string[][]): {
  candidates: SupplierImportCandidate[];
  headerError: string | null;
} {
  if (rows.length === 0) {
    return { candidates: [], headerError: "The file is empty." };
  }

  const headers = rows[0].map(normalizeHeader);
  const missing = ["name", "supplier_code", "supplier_type", "whatsapp"].filter(
    (required) => !headers.includes(required),
  );
  if (missing.length > 0) {
    return {
      candidates: [],
      headerError: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the expected format.`,
    };
  }

  const index = (key: string) => headers.indexOf(key);
  const cell = (row: string[], key: string) => {
    const at = index(key);
    return at === -1 ? "" : (row[at] ?? "").trim();
  };

  const candidates: SupplierImportCandidate[] = rows.slice(1).map((row, i) => {
    const mappingErrors: string[] = [];

    const supplierType = normalizeEnum(cell(row, "supplier_type"), SUPPLIER_TYPE_LABELS);
    if (!supplierType) {
      mappingErrors.push(
        `Unrecognised supplier type "${cell(row, "supplier_type")}".`,
      );
    }

    const { categories, unknown } = normalizeCategories(cell(row, "service_categories"));
    if (unknown.length > 0) {
      mappingErrors.push(`Unrecognised service categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}.`);
    }

    const status = normalizeEnum(cell(row, "status") || "Active", {
      ACTIVE: "Active",
      INACTIVE: "Inactive",
    });
    if (!status) {
      mappingErrors.push(`Unrecognised status "${cell(row, "status")}".`);
    }

    const preferredChannelRaw = cell(row, "preferred_channel");
    const preferredChannel = preferredChannelRaw
      ? normalizeEnum(preferredChannelRaw, PREFERRED_CHANNEL_LABELS)
      : "WHATSAPP";
    if (preferredChannelRaw && !preferredChannel) {
      mappingErrors.push(`Unrecognised preferred channel "${preferredChannelRaw}".`);
    }

    const currencyRaw = cell(row, "currency");
    const currency = currencyRaw ? normalizeEnum(currencyRaw, CURRENCY_LABELS) : "SAR";
    if (currencyRaw && !currency) {
      mappingErrors.push(`Unrecognised currency "${currencyRaw}".`);
    }

    const paymentTermsRaw = cell(row, "payment_terms");
    const paymentTerms = paymentTermsRaw
      ? normalizeEnum(paymentTermsRaw, PAYMENT_TERMS_LABELS)
      : "PAY_AFTER_CONFIRMATION";
    if (paymentTermsRaw && !paymentTerms) {
      mappingErrors.push(`Unrecognised payment terms "${paymentTermsRaw}".`);
    }

    const leadTimeRaw = cell(row, "lead_time_days");
    const leadTimeDays = leadTimeRaw ? parseInteger(leadTimeRaw) : null;
    if (leadTimeRaw && leadTimeDays === null) {
      mappingErrors.push(`Invalid lead time "${leadTimeRaw}".`);
    }

    const payload: CreateSupplierInput = {
      name: cell(row, "name"),
      supplierCode: cell(row, "supplier_code").toUpperCase(),
      supplierType: (supplierType ?? "OTHER") as CreateSupplierInput["supplierType"],
      serviceCategories: categories as CreateSupplierInput["serviceCategories"],
      status: (status ?? "ACTIVE") as CreateSupplierInput["status"],
      city: cell(row, "city") || undefined,
      country: cell(row, "country") || undefined,
      contactName: cell(row, "contact_name") || undefined,
      whatsappNumber: cell(row, "whatsapp"),
      email: cell(row, "email") || undefined,
      preferredChannel: (preferredChannel ?? undefined) as
        | CreateSupplierInput["preferredChannel"]
        | undefined,
      arabicSpeaking: parseBoolean(cell(row, "arabic_speaking"), false),
      currency: (currency ?? "SAR") as CreateSupplierInput["currency"],
      paymentTerms: (paymentTerms ?? "PAY_AFTER_CONFIRMATION") as CreateSupplierInput["paymentTerms"],
      leadTimeDays,
      internalNotes: cell(row, "internal_notes") || undefined,
    };

    if (!payload.name) mappingErrors.push("Name is required.");
    if (!payload.supplierCode) mappingErrors.push("Supplier code is required.");
    if (!payload.whatsappNumber) mappingErrors.push("WhatsApp / phone is required.");

    return {
      rowNumber: i + 1,
      name: payload.name || "(unnamed)",
      supplierCode: payload.supplierCode || "—",
      payload,
      mappingErrors,
    };
  });

  return { candidates, headerError: null };
}
