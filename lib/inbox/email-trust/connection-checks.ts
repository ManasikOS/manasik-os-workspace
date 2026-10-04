import "server-only";

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

export type EmailConnectionCheckCode = "PASS" | "AUTH_FAILED" | "CONNECTION_FAILED" | "TEST_SEND_FAILED" | "NOT_CONFIGURED";
export interface EmailConnectionCheckResult { smtp: EmailConnectionCheckCode; imap: EmailConnectionCheckCode; }
export interface EmailConnectionCheckConfig { host: string; port: number; security: "STARTTLS" | "TLS"; username: string; password: string; fromName: string; fromEmail: string; replyTo: string; imapHost: string | null; imapPort: number | null; imapSecurity: "STARTTLS" | "TLS" | null; testRecipient: string; }

function safeCode(error: unknown): EmailConnectionCheckCode {
  const code = (error as { code?: string } | null)?.code;
  return code === "EAUTH" || (error as { authenticationFailed?: boolean } | null)?.authenticationFailed ? "AUTH_FAILED" : "CONNECTION_FAILED";
}

export async function runEmailConnectionChecks(config: EmailConnectionCheckConfig): Promise<EmailConnectionCheckResult> {
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.security === "TLS", requireTLS: config.security === "STARTTLS", auth: { user: config.username, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, dnsTimeout: 10_000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  let smtp: EmailConnectionCheckCode;
  try {
    await transport.verify();
    const result = await transport.sendMail({ from: { name: config.fromName, address: config.fromEmail }, to: config.testRecipient, replyTo: config.replyTo || undefined, subject: "Email connection check", text: "This test confirms the CRM can submit email through the saved SMTP settings. It does not confirm Inbox placement." });
    smtp = result.accepted.length > 0 ? "PASS" : "TEST_SEND_FAILED";
  } catch (error) { smtp = safeCode(error); } finally { transport.close(); }
  if (!config.imapHost || !config.imapPort || !config.imapSecurity) return { smtp, imap: "NOT_CONFIGURED" };
  const imap = new ImapFlow({ host: config.imapHost, port: config.imapPort, secure: config.imapSecurity === "TLS", auth: { user: config.username, pass: config.password }, logger: false });
  try { await imap.connect(); await imap.getMailboxLock("INBOX").then(lock => lock.release()); return { smtp, imap: "PASS" }; } catch (error) { return { smtp, imap: safeCode(error) }; } finally { await imap.logout().catch(() => undefined); }
}
