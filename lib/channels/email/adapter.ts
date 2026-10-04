/**
 * Email behind the channel-adapter seam (Phase 1 of docs/inbox/email-channel-implementation-plan.md).
 * Sends through the agency's own SMTP mailbox — the same nodemailer transport construction, Vault
 * password read and SMTP error-code mapping `sendSmtpTestEmail`
 * (app/(main)/management/settings/email/actions.ts) already uses for its manual test send, moved here
 * so the outbox drain can address it through the shared `ChannelRuntimeAdapter` seam instead of a
 * one-off test action. Inbound (IMAP polling) is Phase 2 — this adapter only sends.
 */

import "server-only";

import nodemailer from "nodemailer";
import type { ChannelErrorClass, ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { getChannelProfile } from "@/lib/channels/profile";
import type { Db } from "@/lib/data/whatsapp-repository";

interface EmailProviderMetadata {
  host?: string;
  port?: number;
  security?: "STARTTLS" | "TLS";
  username?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

interface ChannelConnectionRow {
  id: string;
  status: string;
  credential_ref: string | null;
  provider_metadata: unknown;
}

/** Null when the connection row exists but its SMTP configuration is incomplete — never guessed. */
function toConnection(row: ChannelConnectionRow): ResolvedChannelConnection | null {
  const metadata = (row.provider_metadata ?? {}) as EmailProviderMetadata;
  if (!metadata.host || !metadata.port || !metadata.security || !metadata.username || !metadata.fromEmail) return null;
  return {
    provider: "GMAIL",
    id: row.id,
    status: row.status,
    credentialRef: row.credential_ref,
    displayAddress: metadata.fromEmail,
    fundingStatus: null,
    accountId: metadata.fromEmail,
    smtpConfig: {
      host: metadata.host,
      port: metadata.port,
      security: metadata.security,
      username: metadata.username,
      fromName: metadata.fromName ?? "",
      fromEmail: metadata.fromEmail,
      replyTo: metadata.replyTo ?? "",
    },
  };
}

async function resolveAgencyConnection(db: Db, agencyId: string): Promise<ResolvedChannelConnection | null> {
  const { data } = await db.from("channel_connections").select("id, status, credential_ref, provider_metadata")
    .eq("agency_id", agencyId).eq("provider", "GMAIL").maybeSingle();
  return data ? toConnection(data as ChannelConnectionRow) : null;
}

async function resolveById(db: Db, agencyId: string, channelConnectionId: string): Promise<ResolvedChannelConnection | null> {
  const { data } = await db.from("channel_connections").select("id, status, credential_ref, provider_metadata")
    .eq("id", channelConnectionId).eq("agency_id", agencyId).eq("provider", "GMAIL").maybeSingle();
  return data ? toConnection(data as ChannelConnectionRow) : null;
}

function buildTransport(config: NonNullable<ResolvedChannelConnection["smtpConfig"]>, password: string) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "TLS",
    requireTLS: config.security === "STARTTLS",
    auth: { user: config.username, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    dnsTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}

/** Same table nodemailer's error codes map to as `sendSmtpTestEmail` uses — only the ones with a clear, safe classification. */
const AUTH_FAILURE_CODES = new Set(["EAUTH", "EENVELOPE"]);

export const gmailChannelAdapter: ChannelRuntimeAdapter = {
  provider: "GMAIL",
  profile: getChannelProfile("GMAIL"),

  async resolveConnection(db, agencyId) {
    return resolveAgencyConnection(db, agencyId);
  },

  async resolveConnectionForChannelConnection(db, agencyId, channelConnectionId) {
    return resolveById(db, agencyId, channelConnectionId);
  },

  async readToken(db, connection) {
    if (!connection.credentialRef) return null;
    // Same service-role-only Vault reader `sendSmtpTestEmail` uses; the reference only ever comes from
    // an agency-scoped `channel_connections`/`agency_smtp_settings` read, never from client input.
    const { data, error } = await db.rpc("whatsapp_read_secret", { p_credential_ref: connection.credentialRef });
    if (error || typeof data !== "string" || !data) return null;
    return data;
  },

  decorateReplyText(text) {
    return text; // No channel-specific decoration for email.
  },

  async sendReply(connection, token, reply) {
    if (!connection.smtpConfig) throw new Error("Email connection is missing its SMTP configuration.");
    const transport = buildTransport(connection.smtpConfig, token);
    try {
      const result = await transport.sendMail({
        from: { name: connection.smtpConfig.fromName, address: connection.smtpConfig.fromEmail },
        to: [{ address: reply.to, name: "" }],
        replyTo: connection.smtpConfig.replyTo ? { address: connection.smtpConfig.replyTo, name: "" } : undefined,
        cc: reply.cc,
        bcc: reply.bcc,
        // Phase 3 wires a real subject through from the composer; until then a reply with none still sends.
        subject: reply.subject,
        text: reply.text,
        inReplyTo: reply.inReplyTo,
        references: reply.references,
      });
      return { externalMessageId: result.messageId };
    } finally {
      transport.close();
    }
  },

  async sendMedia(connection, token, media) {
    if (!connection.smtpConfig) throw new Error("Email connection is missing its SMTP configuration.");
    const transport = buildTransport(connection.smtpConfig, token);
    try {
      const result = await transport.sendMail({
        from: { name: connection.smtpConfig.fromName, address: connection.smtpConfig.fromEmail },
        to: [{ address: media.to, name: "" }],
        replyTo: connection.smtpConfig.replyTo ? { address: connection.smtpConfig.replyTo, name: "" } : undefined,
        cc: media.cc,
        bcc: media.bcc,
        subject: media.subject,
        text: media.caption ?? "",
        inReplyTo: media.inReplyTo,
        references: media.references,
        attachments: [{ filename: media.filename, path: media.url }],
      });
      return { externalMessageId: result.messageId };
    } finally {
      transport.close();
    }
  },

  classifyError(error): ChannelErrorClass {
    const code = (error as { code?: string } | null)?.code;
    if (code === "EAUTH") return "TOKEN_DEAD";
    if (code && AUTH_FAILURE_CODES.has(code)) return "TOKEN_DEAD";
    return "UNKNOWN";
  },

  async reflectSendFailure(db, connection, _agencyId, errorClass) {
    if (errorClass !== "TOKEN_DEAD") return;
    // Mirrors the WhatsApp adapter: never silently retry a rejected password. The Integrations card and
    // Inbox both read `status`; the settings page's own SMTP form is where it gets fixed.
    await db
      .from("channel_connections")
      .update({ status: "ERROR", last_error: "The mail server rejected the stored password — save the SMTP settings again." })
      .eq("id", connection.id);
  },

  async reflectSendSuccess() {
    // Email has no funding concept to clear (unlike WhatsApp's per-message billing).
  },
};
