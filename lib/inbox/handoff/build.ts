/** Deterministic handoff facts. This module never calls a model or database. */

export interface HandoffOpenItem {
  kind: "READINESS" | "DOCUMENT" | "DOCUMENT_REVIEW" | "PAYMENT";
  label: string;
  count: number;
}

export interface HandoffBuildInput {
  customer: { name: string; phone: string | null };
  booking: { id: string; reference: string; currency: string; outstandingBalance: number };
  selection: { groupName: string; departureDate: string | null; returnDate: string | null };
  commercialStage: string | null;
  /** Group-level readiness tasks. Optional ones (`required: false`) never count as open. */
  readiness: Array<{ label: string; status: string; required?: boolean }>;
  /** Only the documents of THIS booking's travellers — the caller filters by the booking's pilgrims. */
  documents: Array<{ name: string; status: string; required?: boolean }>;
}

export interface DeterministicHandoff {
  summary: Record<string, unknown>;
  openItems: HandoffOpenItem[];
}

const READINESS_DONE = ["COMPLETE", "NOT_REQUIRED"];
/** A document nobody has supplied (or one that was refused and must be supplied again). */
const DOCUMENT_MISSING = ["NOT_SUBMITTED", "REJECTED"];
/** Supplied, but not yet checked by the verifying role. */
const DOCUMENT_AWAITING_CHECK = ["SUBMITTED"];

function countItems(kind: HandoffOpenItem["kind"], values: string[]): HandoffOpenItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ kind, label, count }));
}

/** The snapshot's facts are intentionally compact, human-readable and figure-safe. */
export function buildConversationHandoff(input: HandoffBuildInput): DeterministicHandoff {
  const readiness = countItems(
    "READINESS",
    input.readiness.filter((item) => item.required !== false && !READINESS_DONE.includes(item.status)).map((item) => item.label),
  );
  const requiredDocuments = input.documents.filter((item) => item.required !== false);
  const missing = countItems("DOCUMENT", requiredDocuments.filter((item) => DOCUMENT_MISSING.includes(item.status)).map((item) => item.name));
  const awaitingCheck = countItems("DOCUMENT_REVIEW", requiredDocuments.filter((item) => DOCUMENT_AWAITING_CHECK.includes(item.status)).map((item) => item.name));
  const payment = input.booking.outstandingBalance > 0
    ? [{ kind: "PAYMENT" as const, label: `Outstanding ${input.booking.currency} ${input.booking.outstandingBalance.toFixed(2)}`, count: 1 }]
    : [];

  return {
    summary: {
      customer: input.customer,
      booking: { reference: input.booking.reference },
      selection: input.selection,
      commercialStage: input.commercialStage,
    },
    openItems: [...readiness, ...missing, ...awaitingCheck, ...payment],
  };
}

function pluralised(label: string, count: number): string {
  const lower = `${label.slice(0, 1).toLocaleLowerCase()}${label.slice(1)}`;
  return `${count} ${lower}${count === 1 || lower.endsWith("s") ? "" : "s"}`;
}

/** Plain-language line for one open item, e.g. "2 passport scans missing". */
export function handoffItemSentence(item: HandoffOpenItem): string {
  if (item.kind === "PAYMENT") return item.label;
  if (item.kind === "READINESS") return `Group task not complete: ${item.label}${item.count > 1 ? ` (×${item.count})` : ""}`;
  if (item.kind === "DOCUMENT_REVIEW") return `${pluralised(item.label, item.count)} awaiting verification`;
  return `${pluralised(item.label, item.count)} missing`;
}
