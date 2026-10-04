/**
 * Invoices proposal kinds — plan §4.13. `module: "finance"`,
 * `subjectType: "INVOICE"`, backed by `loadInvoicePack()`
 * (`../invoice-pack.ts`). `INVOICE_SEND_REMINDER` calls the existing
 * `sendInvoice()` mutator — the same one a human uses from the invoice
 * detail page — so approving this can never do anything a human couldn't
 * already do by clicking "Send" themselves. Per plan §4.13 "Never: Issue,
 * void, credit → no executor" this never touches those.
 */

import { z } from "zod";

import { sendInvoice } from "@/lib/data/finance-repository";
import { loadInvoicePack, type InvoiceContextPack } from "@/lib/agent/kernel/proposals/invoice-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

const SendReminderSchema = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(["WHATSAPP", "EMAIL", "PORTAL", "MANUAL"]),
});
type SendReminderPayload = z.infer<typeof SendReminderSchema>;

export const invoiceSendReminderExecutor: ProposalExecutor<SendReminderPayload, InvoiceContextPack> = {
  kind: "INVOICE_SEND_REMINDER",
  module: "finance",
  subjectType: "INVOICE",
  schema: SendReminderSchema,
  requiredCapability: "sendReminders",
  risk: "HIGH",
  ttlHours: 48,
  loadPack: loadInvoicePack,
  fingerprint: (p) => `INVOICE_SEND_REMINDER:${p.invoiceId}`,
  dependencySnapshot: (_p, pack) => ({ status: pack.facts.status, sentAt: pack.facts.sentAt }),
  describe: (p) => ({ humanDiff: [{ field: "channel", from: null, to: p.channel }] }),
  execute: async (p, ctx) => {
    const outcome = await sendInvoice(ctx.db, { invoiceId: p.invoiceId, channel: p.channel }, { id: ctx.actor.id, name: ctx.actor.name });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true };
  },
};
