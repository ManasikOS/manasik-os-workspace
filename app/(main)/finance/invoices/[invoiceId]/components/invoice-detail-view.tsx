"use client";

import { useState, useTransition } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import Link from "next/link";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import SectionHeading from "@/components/section-heading";
import { CheckCircle2, FileMinus, Loader2, Send, XCircle } from "lucide-react";

import type { FinanceCapabilities } from "@/lib/access/finance-access";
import { INVOICE_SENT_CHANNEL_LABELS, INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS } from "@/lib/data/finance-copy";
import { INVOICE_STATUS_TONE } from "@/lib/data/finance";
import type {
  InvoiceActivityRow,
  InvoiceAllocationRow,
} from "@/lib/data/finance-repository";
import type { FinanceInvoiceRow, InvoiceLineItemRow, InvoiceSentChannel } from "@/lib/types/finance";
import { formatDate, formatExactCurrency } from "../../../payments/utils";

import { createCreditNoteAction, issueInvoiceAction, sendInvoiceAction, voidInvoiceAction } from "../../../payments/actions";

interface InvoiceDetailViewProps {
  invoice: FinanceInvoiceRow;
  lineItems: InvoiceLineItemRow[];
  creditNotes: FinanceInvoiceRow[];
  allocations: InvoiceAllocationRow[];
  activity: InvoiceActivityRow[];
  originalInvoice: FinanceInvoiceRow | null;
  can: FinanceCapabilities;
}

const SENT_CHANNELS: InvoiceSentChannel[] = ["WHATSAPP", "EMAIL", "PORTAL", "MANUAL"];

export default function InvoiceDetailView({
  invoice,
  lineItems,
  creditNotes,
  allocations,
  activity,
  originalInvoice,
  can,
}: InvoiceDetailViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState<InvoiceSentChannel>("MANUAL");
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidApprovedBy, setVoidApprovedBy] = useState("");

  const issue = () =>
    startTransition(async () => {
      const result = await issueInvoiceAction(invoice.id);
      if (!result.ok) {
        toast.add({ title: "Could not issue invoice", description: result.error });
        return;
      }
      toast.add({ title: "Invoice issued" });
    });

  const confirmSend = () =>
    startTransition(async () => {
      const result = await sendInvoiceAction({ invoiceId: invoice.id, channel });
      if (!result.ok) {
        toast.add({ title: "Could not send invoice", description: result.error });
        return;
      }
      toast.add({ title: "Invoice marked sent" });
      setSending(false);
    });

  const confirmVoid = () =>
    startTransition(async () => {
      const result = await voidInvoiceAction({ invoiceId: invoice.id, reason: voidReason, approvedBy: voidApprovedBy.trim() || undefined });
      if (!result.ok) {
        toast.add({ title: "Could not void invoice", description: result.error });
        return;
      }
      toast.add({ title: "Invoice voided" });
      setVoiding(false);
    });

  const createCreditNote = () =>
    startTransition(async () => {
      const result = await createCreditNoteAction(invoice.id);
      if (!result.ok) {
        toast.add({ title: "Could not create credit note", description: result.error });
        return;
      }
      toast.add({ title: "Credit note created", description: result.invoiceNumber });
      if (result.invoiceId) router.push(`/finance/invoices/${result.invoiceId}`);
    });

  const isDraft = invoice.status === "DRAFT";
  const isVoid = invoice.status === "VOID";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={invoice.invoice_number}
        breadcrumb={[
          { title: "Finance", link: "/finance" },
          { title: "Invoices", link: "/finance?view=receivables&subview=invoices" },
          { title: invoice.invoice_number, link: `/finance/invoices/${invoice.id}` },
        ]}
        subTitle={`${invoice.party_name || "—"} · ${invoice.booking_reference ?? invoice.supplier_commitment_reference ?? "—"}`}
        action={
          <div className="flex items-center gap-2">
            {can.createInvoices && isDraft && (
              <Button size="sm" variant="outline_without_border" onClick={issue} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Issue
              </Button>
            )}
            {can.sendInvoices && !isDraft && !isVoid && (
              <Button size="sm" variant="outline_without_border" onClick={() => setSending(true)} disabled={pending}>
                <Send /> Send
              </Button>
            )}
            {can.voidInvoices && !isVoid && !invoice.credit_note_of && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setVoiding(true)} disabled={pending}>
                  <XCircle /> Void
                </Button>
                {invoice.invoice_type !== "REFUND_CREDIT_NOTE" && (
                  <Button size="sm" variant="ghost" onClick={createCreditNote} disabled={pending}>
                    <FileMinus /> Credit Note
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <ToneBadge tone={INVOICE_STATUS_TONE[invoice.status]} label={INVOICE_STATUS_LABELS[invoice.status]} />
        <span className="text-xs text-muted-foreground">{INVOICE_TYPE_LABELS[invoice.invoice_type]}</span>
        {invoice.credit_note_of && originalInvoice && (
          <Link href={`/finance/invoices/${originalInvoice.id}`} className="text-xs text-muted-foreground underline">
            Credit note for {originalInvoice.invoice_number}
          </Link>
        )}
        {creditNotes.length > 0 && (
          <Link href={`/finance/invoices/${creditNotes[0].id}`} className="text-xs text-muted-foreground underline">
            {creditNotes.length} credit note{creditNotes.length === 1 ? "" : "s"} →
          </Link>
        )}
      </div>

      <Card className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">Amount</span>
          <span className="text-sm text-foreground font-number">{formatExactCurrency(invoice.amount, invoice.currency)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">Due</span>
          <span className="text-sm text-foreground">{invoice.due_at ? formatDate(invoice.due_at) : "—"}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">Issued</span>
          <span className="text-sm text-foreground">{invoice.issued_at ? formatDate(invoice.issued_at) : "Not yet issued"}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">Delivery</span>
          <span className="text-sm text-foreground">
            {invoice.sent_channel ? `${INVOICE_SENT_CHANNEL_LABELS[invoice.sent_channel]} · ${formatDate(invoice.sent_at!)}` : "Not sent"}
          </span>
        </div>
        {invoice.viewed_at && <div className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Viewed</span><span className="text-sm text-foreground">{formatDate(invoice.viewed_at)}</span></div>}
        {isVoid && (
          <div className="flex flex-col gap-0.5 col-span-2">
            <span className="text-[11px] text-muted-foreground">Void reason</span>
            <span className="text-sm text-foreground">
              {invoice.void_reason}
              {invoice.void_approved_by && ` — approved by ${invoice.void_approved_by}`}
            </span>
          </div>
        )}
      </Card>

      <div>
        <SectionHeading title="Lines" />
        {lineItems.length === 0 ? (
          <EmptyState title="No line items" />
        ) : (
          <Card className="p-0 overflow-x-auto no-scrollbar mt-3">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Description", "Qty", "Unit", "Total"].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {lineItems.map((item) => (
                  <TableRow key={item.id} className="hover:bg-transparent">
                    <TableCell className="px-3 py-2.5 text-sm text-foreground">{item.description}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">{item.quantity}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">{formatExactCurrency(item.unit_amount, invoice.currency)}</TableCell>
                    <TableCell className="px-3 py-2.5 text-sm font-number text-foreground">{formatExactCurrency(item.line_total, invoice.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <div>
        <SectionHeading title="Payments applied" />
        {allocations.length === 0 ? (
          <EmptyState
            title="No allocations to show here"
            description={
              invoice.milestone_id
                ? "No payment has been allocated to this invoice's milestone yet."
                : "This invoice isn't linked to a single milestone — its payments show on the booking's own Payments tab."
            }
          />
        ) : (
          <Card className="p-0 divide-y divide-border/20 mt-3">
            {allocations.map((a) => (
              <div key={a.paymentId} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-foreground">{a.paymentReference}</span>
                <span className="text-xs text-muted-foreground">{formatDate(a.paidAt)}</span>
                <span className="text-sm font-number text-foreground">{formatExactCurrency(a.amount, invoice.currency)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div>
        <SectionHeading title="Activity" />
        {activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Card className="p-0 divide-y divide-border/20 mt-3">
            {activity.map((a) => (
              <div key={a.id} className="px-4 py-2.5">
                <p className="text-sm text-foreground">
                  {a.action.replace(/_/g, " ").toLowerCase()}
                  {a.note ? ` — ${a.note}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {a.actorName ?? "—"} · {formatDate(a.createdAt)}
                </p>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send invoice</DialogTitle>
            <DialogDescription>{invoice.invoice_number}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
            <select
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
              value={channel}
              onChange={(e) => setChannel(e.target.value as InvoiceSentChannel)}
            >
              {SENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {INVOICE_SENT_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSending(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSend} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : "Mark sent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void invoice</DialogTitle>
            <DialogDescription>{invoice.invoice_number} — this cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reason *</label>
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why is this invoice being voided?" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Second approver (optional)</label>
              <Input value={voidApprovedBy} onChange={(e) => setVoidApprovedBy(e.target.value)} placeholder="Name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoiding(false)}>
              Cancel
            </Button>
            <Button onClick={confirmVoid} disabled={pending || !voidReason.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : "Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
