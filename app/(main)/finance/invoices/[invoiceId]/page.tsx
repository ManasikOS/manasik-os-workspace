import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  getFinanceInvoice,
  listInvoiceActivity,
  listInvoiceAllocations,
  listInvoiceCreditNotes,
  listInvoiceLineItems,
} from "@/lib/data/finance-repository";
import { createClient } from "@/utils/supabase/server";

import InvoiceDetailView from "./components/invoice-detail-view";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForFinance(role);
  if (!can.viewModule || !can.viewInvoices) notFound();

  const supabase = createClient(await cookies());
  const invoice = await getFinanceInvoice(supabase, invoiceId);
  if (!invoice) notFound();

  const [lineItems, creditNotes, allocations, activity] = await Promise.all([
    listInvoiceLineItems(supabase, invoiceId),
    listInvoiceCreditNotes(supabase, invoiceId),
    listInvoiceAllocations(supabase, invoice.milestone_id),
    listInvoiceActivity(supabase, invoiceId),
  ]);

  const originalInvoice = invoice.credit_note_of ? await getFinanceInvoice(supabase, invoice.credit_note_of) : null;

  return (
    <InvoiceDetailView
      invoice={invoice}
      lineItems={lineItems}
      creditNotes={creditNotes}
      allocations={allocations}
      activity={activity}
      originalInvoice={originalInvoice}
      can={can}
    />
  );
}
