import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const verify = vi.fn(); const sendMail = vi.fn(); const close = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ verify, sendMail, close })) } }));
const connect = vi.fn(); const logout = vi.fn(); const getMailboxLock = vi.fn();
vi.mock("imapflow", () => ({ ImapFlow: vi.fn(() => ({ connect, logout, getMailboxLock })) }));
const { runEmailConnectionChecks } = await import("./connection-checks");
const input = { host: "smtp.example.test", port: 587, security: "STARTTLS" as const, username: "support@example.test", password: "secret", fromName: "Agency", fromEmail: "support@example.test", replyTo: "", imapHost: "imap.example.test", imapPort: 993, imapSecurity: "TLS" as const, testRecipient: "test@example.test" };
describe("runEmailConnectionChecks", () => {
  it("records SMTP submission and IMAP INBOX checks independently", async () => { verify.mockResolvedValue(undefined); sendMail.mockResolvedValue({ accepted: ["test@example.test"] }); connect.mockResolvedValue(undefined); getMailboxLock.mockResolvedValue({ release: vi.fn() }); logout.mockResolvedValue(undefined); await expect(runEmailConnectionChecks(input)).resolves.toEqual({ smtp: "PASS", imap: "PASS" }); });
  it("maps a bad password to a safe recoverable result without returning transport text", async () => { verify.mockRejectedValue({ code: "EAUTH", message: "password=secret" }); connect.mockRejectedValue({ authenticationFailed: true }); logout.mockResolvedValue(undefined); await expect(runEmailConnectionChecks(input)).resolves.toEqual({ smtp: "AUTH_FAILED", imap: "AUTH_FAILED" }); });
});
