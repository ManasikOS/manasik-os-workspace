import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForVisa } from "@/lib/access/visa-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { toVisaListItems } from "@/lib/data/visa";
import { loadVisaQueue } from "@/lib/data/visa-repository";
import { createClient } from "@/utils/supabase/server";
import { withTiming } from "@/lib/timing";

import VisaList from "./components/visa-list";
import { VisaProvider } from "./visa-store";

/**
 * Visa Operations. A Server Component so every "days to departure" /
 * "expiring soon" / "no update for N days" derivation is measured against a
 * clock decided once and serialised down — same reasoning as
 * `app/(main)/documents/page.tsx`.
 *
 * Reads `visa_application_rows`, the view joining every active group's visa
 * applications to the pilgrim, booking, batch and group each one belongs to
 * (see `supabase/migrations/20260815090000_visa_operations.sql`).
 */
export const dynamic = "force-dynamic";

export default async function VisaPage() {
  // Start the queries before the role lookup resolves instead of after it —
  // the role check only decides whether the result may be shown, and RLS still
  // scopes the rows, so a denied user costs one wasted query rather than every
  // user paying a serial round trip. The no-op catch stops a rejection from
  // surfacing as "unhandled" if `notFound()` throws first; awaiting the promise
  // below still rethrows a real failure.
  const supabase = createClient(await cookies());
  const rowsPromise = withTiming("visa.loadQueue", () => loadVisaQueue(supabase));
  rowsPromise.catch(() => undefined);

  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.viewModule) notFound();

  const rows = await rowsPromise;
  const nowIso = new Date().toISOString();

  let items = toVisaListItems(rows, nowIso);

  // Finance: payment-related blockers only. Nulled here, in the repository
  // shape's consumer, so nothing sensitive ever reaches a Client Component.
  if (can.viewPaymentBlockersOnly) {
    items = items
      .filter((i) => i.outstandingBalance > 0)
      .map((i) => ({
        ...i,
        passportNumber: null,
        passportMasked: "Restricted",
        visaId: null,
        filePath: null,
        rejectionReason: null,
        issueNote: null,
      }));
  }

  // Guide: read-only readiness board, no visa file or number.
  if (!can.viewVisaNumberAndFile) {
    items = items.map((i) => ({ ...i, visaId: null, filePath: null }));
  }
  if (!can.viewFullPassportNumber) {
    items = items.map((i) => ({ ...i, passportNumber: null }));
  }

  return (
    <VisaProvider applications={items} nowIso={nowIso} currentStaffName={name} role={role} can={can}>
      <VisaList />
    </VisaProvider>
  );
}
