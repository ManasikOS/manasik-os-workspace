"use server";

import { z } from "zod";
import nodemailer from "nodemailer";
import { revalidatePath } from "next/cache";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { agencySmtpSettingsSchema } from "@/lib/validations/agency-email-settings";
import { emailDeliveryProfileSetupSchema } from "@/lib/inbox/email-trust/provider-profiles";
import { runEmailConnectionChecks } from "@/lib/inbox/email-trust/connection-checks";
import { inspectDomainAuthentication } from "@/lib/inbox/email-trust/domain-resolver";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCommunicationsSectionData } from "../dialog-actions";

const schema = agencySmtpSettingsSchema;

export async function getEmailSectionData() {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!agencyId || (!can.viewIntegrations && !can.viewCommunications)) return { ok: false as const };
  const communications = can.viewCommunications ? await getCommunicationsSectionData() : null;
  let smtp = null;
  let domainCheck = null;
  let smtpError: string | null = null;
  if (can.viewIntegrations) {
    const result = await createAdminClient().from("agency_smtp_settings")
      .select("host, port, security, username, from_name, from_email, reply_to, imap_host, imap_port, imap_security")
      .eq("agency_id", agencyId).maybeSingle();
    smtp = result.data;
    const checkResult = await createAdminClient().from("agency_email_domain_check_runs").select("sender_domain, dkim_selector, spf_state, dkim_state, dmarc_state, checked_at").eq("agency_id", agencyId).order("checked_at", { ascending: false }).limit(1).maybeSingle();
    domainCheck = checkResult.data;
    if (result.error) smtpError = "SMTP storage is unavailable. Apply the agency SMTP settings database migration.";
  }
  return { ok: true as const, smtp, domainCheck, smtpError, canViewSmtp: can.viewIntegrations,
    canEditSmtp: can.editIntegrations,
    templates: communications?.ok ? communications.templates.filter(t => t.channel === "EMAIL") : [],
    canEditTemplates: can.editCommunications,
    scopedRole: can.communicationsScopedToOwnRole ? role : null };
}

export async function recheckEmailDomainAuthentication(input: unknown) {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForSettings(role).editIntegrations) return { ok: false as const, error: "Your role cannot check email DNS settings." };
  const parsed = z.object({ dkimSelector: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter the DKIM selector from your email provider." };
  const admin = createAdminClient();
  const { data: smtp } = await admin.from("agency_smtp_settings").select("from_email").eq("agency_id", agencyId).maybeSingle();
  if (!smtp?.from_email) return { ok: false as const, error: "Save your sender email before checking DNS." };
  const domain = smtp.from_email.slice(smtp.from_email.lastIndexOf("@") + 1).toLowerCase();
  const checked = await inspectDomainAuthentication({ domain, dkimSelector: parsed.data.dkimSelector });
  const { error } = await admin.from("agency_email_domain_check_runs").insert({ agency_id: agencyId, sender_domain: domain, dkim_selector: parsed.data.dkimSelector, spf_state: checked.spf, dkim_state: checked.dkim, dmarc_state: checked.dmarc, checked_at: checked.checkedAt });
  if (error) return { ok: false as const, error: "Could not save the DNS check result. Please retry." };
  revalidatePath("/management/settings");
  return { ok: true as const, data: checked };
}

export async function saveSmtpSettings(input: unknown) {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Your role cannot edit SMTP settings." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the SMTP settings." };
  const { password, imapHost, imapPort, imapSecurity, ...config } = parsed.data;
  const { error } = await createAdminClient().rpc("save_agency_smtp_settings", {
    p_agency_id: agencyId,
    p_config: { ...config, imapHost: imapHost || null, imapPort: imapPort === "" ? null : imapPort, imapSecurity: imapSecurity || null },
    p_password: password || null,
  });
  if (error) return { ok: false, error: "Could not save SMTP settings. Ensure storage is available and provide a password for the first setup." };
  revalidatePath("/management/settings");
  return { ok: true };
}

/** Sends one fixed test message using this agency's saved credentials. */
export async function sendSmtpTestEmail(recipient: unknown) {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForSettings(role).editIntegrations) {
    return { ok: false, error: "Your role cannot test SMTP settings." };
  }
  const parsed = z.string().trim().email().max(320).safeParse(recipient);
  if (!parsed.success) return { ok: false, error: "Enter a valid recipient email address." };

  const admin = createAdminClient();
  const { data: smtp, error } = await admin.from("agency_smtp_settings")
    .select("host, port, security, username, password_ref, from_name, from_email, reply_to")
    .eq("agency_id", agencyId).maybeSingle();
  if (error || !smtp) return { ok: false, error: "Save your SMTP settings before sending a test email." };

  // Existing service-role-only Vault reader accepts any secret reference.
  // The reference comes exclusively from the agency-scoped server query.
  const { data: password, error: secretError } = await admin.rpc("whatsapp_read_secret", {
    p_credential_ref: smtp.password_ref,
  });
  if (secretError || typeof password !== "string" || !password) {
    return { ok: false, error: "Could not read the saved SMTP password. Save it again and retry." };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port,
    secure: smtp.security === "TLS",
    requireTLS: smtp.security === "STARTTLS",
    auth: { user: smtp.username, pass: password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
  });
  try {
    const result = await transport.sendMail({
      from: { name: smtp.from_name, address: smtp.from_email },
      to: [{ address: parsed.data, name: "" }],
      replyTo: smtp.reply_to ? { address: smtp.reply_to, name: "" } : undefined,
      subject: "SMTP connection test",
      text: "This is a test email from your CRM. Receiving this message confirms that your saved SMTP configuration can send email.\n\nNo reply is required.",
    });
    if (!result.accepted.length) return { ok: false, error: "The SMTP server did not accept the recipient address." };
    return { ok: true, message: "The SMTP server accepted your test email. Check the recipient’s inbox and spam folder." };
  } catch (cause) {
    // Never return raw SMTP errors: they can contain credentials or server transcripts.
    const code = (cause as { code?: string }).code;
    const errors: Record<string, string> = {
      EAUTH: "SMTP authentication failed. Check your username and password or app password.",
      EDNS: "SMTP server could not be found. Check the hostname.",
      ECONNECTION: "Could not connect to the SMTP server. Check the host, port and encryption.",
      ESOCKET: "SMTP connection failed. Check the port, encryption and server certificate.",
      ETIMEDOUT: "The SMTP server timed out. Check its address, port and network access.",
      EENVELOPE: "The SMTP server rejected the sender or recipient address.",
      EMESSAGE: "The SMTP server rejected the test message.",
    };
    return { ok: false, error: errors[code ?? ""] ?? "Test email failed. Check the saved SMTP settings and provider’s sending permissions." };
  } finally {
    transport.close();
  }
}

export async function runEmailDeliveryChecks(input: unknown) {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForSettings(role).editIntegrations) return { ok: false as const, error: "Your role cannot run email checks." };
  const request = z.object({ provider: z.enum(["HOSTINGER", "GOOGLE_WORKSPACE", "MICROSOFT_365", "GENERIC"]), recipient: z.string().trim().email().max(320) }).strict().safeParse(input);
  if (!request.success) return { ok: false as const, error: "Choose a provider and enter a valid test recipient." };
  const admin = createAdminClient();
  const { data: smtp } = await admin.from("agency_smtp_settings").select("host, port, security, username, password_ref, from_name, from_email, reply_to, imap_host, imap_port, imap_security").eq("agency_id", agencyId).maybeSingle();
  if (!smtp) return { ok: false as const, error: "Save your email settings before running checks." };
  const valid = emailDeliveryProfileSetupSchema.safeParse({ provider: request.data.provider, smtpHost: smtp.host, smtpPort: smtp.port, smtpSecurity: smtp.security, imapHost: smtp.imap_host, imapPort: smtp.imap_port, imapSecurity: smtp.imap_security, username: smtp.username, fromEmail: smtp.from_email });
  if (!valid.success) return { ok: false as const, error: valid.error.issues[0]?.message ?? "Check the saved email settings." };
  const { data: password } = await admin.rpc("whatsapp_read_secret", { p_credential_ref: smtp.password_ref });
  if (typeof password !== "string" || !password) return { ok: false as const, error: "Could not read the saved password. Save it again and retry." };
  const result = await runEmailConnectionChecks({ host: smtp.host, port: smtp.port, security: smtp.security, username: smtp.username, password, fromName: smtp.from_name, fromEmail: smtp.from_email, replyTo: smtp.reply_to ?? "", imapHost: smtp.imap_host, imapPort: smtp.imap_port, imapSecurity: smtp.imap_security, testRecipient: request.data.recipient });
  const senderDomain = smtp.from_email.slice(smtp.from_email.lastIndexOf("@") + 1).toLowerCase();
  await admin.from("agency_email_delivery_profiles").upsert({ agency_id: agencyId, provider_code: request.data.provider, sender_domain: senderDomain, smtp_check_code: result.smtp, imap_check_code: result.imap, smtp_checked_at: new Date().toISOString(), imap_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "agency_id" });
  revalidatePath("/management/settings");
  return { ok: true as const, data: result };
}
