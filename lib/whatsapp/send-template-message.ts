/**
 * Sends one approved WhatsApp template to one number and reports what was sent. Extracted from the Inbox's
 * `startWhatsAppChat` action so the follow-up sweep — which runs from a cron with no staff session — sends
 * templates through exactly the same checks: the template must be approved and belong to the agency, every
 * body variable must be filled, the connection must be ready, and a dead token or unfunded account is
 * reflected on the integration at once.
 *
 * It only SENDS. Recording the message in the conversation is the caller's job, because staff and the
 * cron record it differently (different author, different metadata).
 */

import "server-only";

import { classifyWhatsAppError, sendTemplate } from "@/lib/whatsapp/client";
import { buildTemplateSendComponentsFromValues, countBodyVariables, renderTemplateText } from "@/lib/whatsapp/template-params";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import type { Db } from "@/lib/data/whatsapp-repository";
import { checkMarketingSendAllowed } from "@/lib/data/whatsapp-billing-repository";
import { randomUUID } from "node:crypto";

import { loadAgencyIsTest } from "@/lib/inbox/outbound/test-agency-send-guard";
import { outboundRecipientRefusal } from "@/lib/inbox/outbound/outbound-allowlist";

export type SendApprovedTemplateFailure =
  | "TEMPLATE_NOT_APPROVED"
  | "MISSING_VARIABLES"
  | "NOT_CONNECTED"
  | "CONNECTION_NOT_READY"
  | "TOKEN_UNREADABLE"
  | "TOKEN_DEAD"
  | "UNFUNDED"
  | "SEND_FAILED";

export type SendApprovedTemplateResult =
  | {
      ok: true;
      externalMessageId: string;
      /** The template as the customer reads it, with variables filled in. */
      renderedText: string;
      template: { id: string; name: string; language: string; category: string };
      bodyParameters: string[];
    }
  | { ok: false; reason: SendApprovedTemplateFailure; error: string };

export async function sendApprovedTemplate(input: {
  /** The admin client. */
  db: Db;
  agencyId: string;
  /** The customer's WhatsApp id (digits only, with country code). */
  to: string;
  templateId: string;
  values: string[];
}): Promise<SendApprovedTemplateResult> {
  const { db, agencyId, to } = input;

  // A disposable test agency never reaches Meta: after the same template and budget checks, the send is answered locally.
  let agencyIsTest: boolean;
  try {
    agencyIsTest = await loadAgencyIsTest(db, agencyId);
  } catch {
    return { ok: false, reason: "SEND_FAILED", error: "The agency could not be checked, so nothing was sent." };
  }
  // Outside production a real agency sends only to approved test contacts (a test agency never reaches Meta, so it is not subject to the list).
  if (!agencyIsTest) {
    const recipientRefusal = outboundRecipientRefusal(to);
    if (recipientRefusal) return { ok: false, reason: "SEND_FAILED", error: recipientRefusal };
  }

  const { data: template, error: templateError } = await db
    .from("whatsapp_templates")
    .select("id, name, language, category, components")
    .eq("id", input.templateId)
    .eq("agency_id", agencyId)
    .eq("status", "APPROVED")
    .maybeSingle();
  if (templateError || !template) {
    return { ok: false, reason: "TEMPLATE_NOT_APPROVED", error: "That template is no longer approved. Sync templates and try again." };
  }

  const parameterCount = countBodyVariables(template.components);
  const bodyParameters = input.values.slice(0, parameterCount).map((value) => value.trim());
  if (bodyParameters.length !== parameterCount || bodyParameters.some((value) => !value)) {
    return { ok: false, reason: "MISSING_VARIABLES", error: "Fill in every template variable before sending." };
  }

  const budgetDecision = await checkMarketingSendAllowed(db, agencyId, String(template.category));
  if (!budgetDecision.allowed) {
    return { ok: false, reason: "SEND_FAILED", error: budgetDecision.reason };
  }

  if (agencyIsTest) {
    return {
      ok: true,
      externalMessageId: `sim.template.${randomUUID()}`,
      renderedText: renderTemplateText(template.components, bodyParameters),
      template: { id: template.id as string, name: template.name as string, language: template.language as string, category: template.category as string },
      bodyParameters,
    };
  }

  const { data: integration, error: integrationError } = await db
    .from("whatsapp_integrations")
    .select("id, phone_number_id, credential_ref, status")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (integrationError || !integration?.phone_number_id || !integration.credential_ref) {
    return { ok: false, reason: "NOT_CONNECTED", error: "WhatsApp is not connected for this agency." };
  }
  if (integration.status !== "CONNECTED") {
    return { ok: false, reason: "CONNECTION_NOT_READY", error: "The WhatsApp connection is not ready. Check Settings > Integrations." };
  }

  const accessKey = await readWhatsAppToken(db, integration.credential_ref as string);
  if (!accessKey) return { ok: false, reason: "TOKEN_UNREADABLE", error: "Could not read the WhatsApp access token." };

  try {
    const result = await sendTemplate(integration.phone_number_id as string, accessKey, to, {
      templateName: template.name as string,
      languageCode: template.language as string,
      components: buildTemplateSendComponentsFromValues(template.components, bodyParameters),
    });
    return {
      ok: true,
      externalMessageId: result.externalMessageId,
      renderedText: renderTemplateText(template.components, bodyParameters),
      template: {
        id: template.id as string,
        name: template.name as string,
        language: template.language as string,
        category: template.category as string,
      },
      bodyParameters,
    };
  } catch (error) {
    const errorClass = classifyWhatsAppError(error);
    if (errorClass === "TOKEN_DEAD") {
      await db
        .from("whatsapp_integrations")
        .update({ status: "ERROR", last_error: "WhatsApp rejected the stored access token — reconnect required." })
        .eq("id", integration.id as string);
      return { ok: false, reason: "TOKEN_DEAD", error: "The WhatsApp connection needs to be reconnected." };
    }
    if (errorClass === "UNFUNDED") {
      await db
        .from("whatsapp_integrations")
        .update({ status: "UNFUNDED", funding_status: "UNFUNDED" })
        .eq("id", integration.id as string);
      return { ok: false, reason: "UNFUNDED", error: "No payment method is attached to the WhatsApp Business Account." };
    }
    return { ok: false, reason: "SEND_FAILED", error: error instanceof Error ? error.message : "Failed to send the WhatsApp template." };
  }
}
