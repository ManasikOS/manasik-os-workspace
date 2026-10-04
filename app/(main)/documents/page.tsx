import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { isAiConfigured } from "@/lib/data/documents-ai";
import { toDocumentListItems } from "@/lib/data/documents";
import { loadDocumentQueue } from "@/lib/data/documents-repository";
import { createClient } from "@/utils/supabase/server";
import { withTiming } from "@/lib/timing";

import DocumentsList from "./components/documents-list";
import { DocumentsProvider } from "./documents-store";

/**
 * Documents Operations. A Server Component so the clock every "days to
 * departure" / "due" / "expiring" derivation is measured against is decided
 * once and serialised down — same reasoning as `app/(main)/pilgrims/page.tsx`.
 *
 * Reads `document_queue_rows`, the view joining every active group's
 * document requirements to the pilgrim and group each one blocks (see
 * `supabase/migrations/20260814090000_documents_operations.sql`).
 */
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  // Start the queries before the role lookup resolves instead of after it —
  // the role check only decides whether the result may be shown, and RLS still
  // scopes the rows, so a denied user costs one wasted query rather than every
  // user paying a serial round trip. The no-op catch stops a rejection from
  // surfacing as "unhandled" if `notFound()` throws first; awaiting the promise
  // below still rethrows a real failure.
  const supabase = createClient(await cookies());
  const rowsPromise = withTiming("documents.loadQueue", () => loadDocumentQueue(supabase));
  rowsPromise.catch(() => undefined);

  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.viewModule) notFound();

  const rows = await rowsPromise;
  const nowIso = new Date().toISOString();

  const documents = toDocumentListItems(
    can.scopedToPaymentProof ? rows.filter((r) => r.document_type === "PAYMENT_PROOF") : rows,
    nowIso,
  );

  return (
    <DocumentsProvider
      documents={documents}
      nowIso={nowIso}
      currentStaffName={name}
      role={role}
      can={can}
      aiConfigured={isAiConfigured()}
    >
      <DocumentsList />
    </DocumentsProvider>
  );
}
