"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EMAIL_DELIVERY_PROVIDER_PROFILES, type EmailDeliveryProviderId } from "@/lib/inbox/email-trust/provider-profiles";
import { TemplateList } from "../communications/template-list";
import { SectionShell } from "../components/section-shell";
import { getEmailSectionData, recheckEmailDomainAuthentication, runEmailDeliveryChecks, saveSmtpSettings, sendSmtpTestEmail } from "./actions";

type EmailData = Extract<Awaited<ReturnType<typeof getEmailSectionData>>, { ok: true }>;

export function EmailSettings({ initial }: { initial: EmailData }) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(Boolean(initial.smtp));
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testing, startTest] = useTransition();
  const [checkProvider, setCheckProvider] = useState<EmailDeliveryProviderId>("GENERIC");
  const [checkRecipient, setCheckRecipient] = useState("");
  const [checkMessage, setCheckMessage] = useState("");
  const [dkimSelector, setDkimSelector] = useState(initial.domainCheck?.dkim_selector ?? "");
  const [dnsMessage, setDnsMessage] = useState("");
  const [form, setForm] = useState({
    host: initial.smtp?.host ?? "", port: String(initial.smtp?.port ?? 587),
    security: initial.smtp?.security ?? "STARTTLS", username: initial.smtp?.username ?? "",
    password: "", fromName: initial.smtp?.from_name ?? "", fromEmail: initial.smtp?.from_email ?? "",
    replyTo: initial.smtp?.reply_to ?? "",
    imapHost: initial.smtp?.imap_host ?? "", imapPort: initial.smtp?.imap_port ? String(initial.smtp.imap_port) : "",
    imapSecurity: initial.smtp?.imap_security ?? "",
  });
  const fields = [
    ["host", "SMTP server", "smtp.example.com"], ["port", "Port", "587"],
    ["username", "Username", "you@example.com"], ["password", "Password", saved ? "Leave blank to keep saved password" : "SMTP password or app password"],
    ["fromName", "Sender name", "Royal Al-Fathima Travels"], ["fromEmail", "Sender email", "bookings@example.com"],
    ["replyTo", "Reply-to email (optional)", "support@example.com"],
  ] as const;
  const imapFields = [
    ["imapHost", "IMAP server (optional)", "imap.example.com"], ["imapPort", "IMAP port", "993"],
  ] as const;

  return <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto custom-scroll">
    {data.canViewSmtp && <SectionShell title="Custom SMTP" description="Configure your agency’s outgoing email server and sender identity.">
      <form onSubmit={event => {
        event.preventDefault(); setMessage("");
        startTransition(async () => {
          try {
            const result = await saveSmtpSettings(form);
            setMessage(result.ok ? "SMTP configuration saved." : result.error ?? "Could not save settings.");
            if (result.ok) { setSaved(true); setForm(previous => ({ ...previous, password: "" })); }
          } catch { setMessage("Could not save settings. Please try again."); }
        });
      }} className="flex flex-col gap-4">
        {data.smtpError && <p role="alert" className="text-sm text-destructive">{data.smtpError}</p>}
        <fieldset disabled={!data.canEditSmtp || pending || testing || Boolean(data.smtpError)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map(([key, label, placeholder]) => <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`smtp-${key}`} className="text-sm font-medium">{label}</label>
            <Input id={`smtp-${key}`} value={form[key]} placeholder={placeholder}
              type={key === "password" ? "password" : key === "port" ? "number" : key === "fromEmail" || key === "replyTo" ? "email" : "text"}
              autoComplete={key === "password" ? "new-password" : "off"}
              required={key !== "replyTo" && key !== "fromName" && (key !== "password" || !saved)}
              onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />
          </div>)}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-security" className="text-sm font-medium">Encryption</label>
            <select id="smtp-security" className="h-9 rounded-md border bg-background px-3 text-sm" value={form.security}
              onChange={event => setForm(previous => ({ ...previous, security: event.target.value }))}>
              <option value="STARTTLS">STARTTLS (usually port 587)</option>
              <option value="TLS">SSL/TLS (usually port 465)</option>
            </select>
          </div>
        </fieldset>
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium">Receiving mail (IMAP)</h3>
          <p className="text-xs text-muted-foreground">Optional. Set this to bring incoming email into the Inbox, using the same username and password above. Leave the IMAP server blank to keep sending only.</p>
        </div>
        <fieldset disabled={!data.canEditSmtp || pending || testing || Boolean(data.smtpError)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {imapFields.map(([key, label, placeholder]) => <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`smtp-${key}`} className="text-sm font-medium">{label}</label>
            <Input id={`smtp-${key}`} value={form[key]} placeholder={placeholder}
              type={key === "imapPort" ? "number" : "text"} autoComplete="off"
              onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />
          </div>)}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="smtp-imap-security" className="text-sm font-medium">IMAP encryption</label>
            <select id="smtp-imap-security" className="h-9 rounded-md border bg-background px-3 text-sm" value={form.imapSecurity}
              onChange={event => setForm(previous => ({ ...previous, imapSecurity: event.target.value }))}>
              <option value="">Not set</option>
              <option value="TLS">SSL/TLS (usually port 993)</option>
              <option value="STARTTLS">STARTTLS (usually port 143)</option>
            </select>
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">Passwords are encrypted. Saving configures the server; it does not send a test email or change authentication emails.</p>
        {message && <p role="status" className="text-sm">{message}</p>}
        {data.canEditSmtp && <Button className="self-start" disabled={pending || testing || Boolean(data.smtpError)} type="submit">{pending ? "Saving…" : "Save SMTP settings"}</Button>}
      </form>
      {data.canEditSmtp && <form className="mt-6 flex flex-col gap-3 border-t pt-5" onSubmit={event => {
        event.preventDefault(); setTestMessage("");
        startTest(async () => {
          try {
            const result = await sendSmtpTestEmail(testRecipient);
            setTestMessage(result.ok ? result.message ?? "Test email accepted." : result.error ?? "Test email failed.");
          } catch { setTestMessage("Could not complete the test. Please try again."); }
        });
      }}>
        <h3 className="text-sm font-medium">Test connection</h3>
        <p className="text-xs text-muted-foreground">Sends one test email using your saved settings. Save any changes above before testing.</p>
        <label htmlFor="smtp-test-recipient" className="text-sm font-medium">Recipient email</label>
        <Input id="smtp-test-recipient" type="email" required value={testRecipient}
          placeholder="you@example.com" disabled={testing || pending}
          onChange={event => setTestRecipient(event.target.value)} />
        <Button type="submit" className="self-start" disabled={testing || pending || !saved || Boolean(data.smtpError) || !testRecipient.trim()}>
          {testing ? "Sending test email…" : "Send test email"}
        </Button>
        {!saved && <p className="text-xs text-muted-foreground">Save an SMTP configuration to enable testing.</p>}
        {testMessage && <p role="status" aria-live="polite" className="text-sm">{testMessage}</p>}
      </form>}
      {data.canEditSmtp && <form className="mt-6 flex flex-col gap-3 border-t pt-5" onSubmit={event => {
        event.preventDefault(); setDnsMessage("");
        startTest(async () => { const result = await recheckEmailDomainAuthentication({ dkimSelector }); setDnsMessage(result.ok ? `SPF: ${result.data.spf}. DKIM: ${result.data.dkim}. DMARC: ${result.data.dmarc}.` : result.error); });
      }}>
        <h3 className="text-sm font-medium">Domain authentication</h3>
        <p className="text-xs text-muted-foreground">Checks public DNS for your saved sender domain. This does not promise Inbox placement.</p>
        <InputGroup><InputGroupAddon align="block-start">DKIM selector</InputGroupAddon><InputGroupInput required value={dkimSelector} placeholder="selector1" disabled={testing || pending} onChange={event => setDkimSelector(event.target.value)} /></InputGroup>
        {data.domainCheck && <p className="text-xs text-muted-foreground">Last check: SPF {data.domainCheck.spf_state}, DKIM {data.domainCheck.dkim_state}, DMARC {data.domainCheck.dmarc_state}.</p>}
        <Button type="submit" className="self-start" disabled={testing || pending || !dkimSelector.trim()}>{testing ? "Checking DNS…" : "Recheck DNS"}</Button>
        {dnsMessage && <p role="status" aria-live="polite" className="text-sm">{dnsMessage}</p>}
      </form>}
      {data.canEditSmtp && <form className="mt-6 flex flex-col gap-3 border-t pt-5" onSubmit={event => {
        event.preventDefault(); setCheckMessage("");
        startTest(async () => {
          const result = await runEmailDeliveryChecks({ provider: checkProvider, recipient: checkRecipient });
          if (!result.ok) { setCheckMessage(result.error); return; }
          setCheckMessage(`SMTP: ${result.data.smtp}. IMAP: ${result.data.imap}. SMTP acceptance does not guarantee Inbox placement.`);
        });
      }}>
        <h3 className="text-sm font-medium">Run email checks</h3>
        <p className="text-xs text-muted-foreground">Checks SMTP and IMAP separately, then sends one consented test message.</p>
        <InputGroup><InputGroupAddon align="block-start">Email provider</InputGroupAddon><Select value={checkProvider} disabled={testing || pending} onValueChange={(value) => { if (!value) return; const provider = EMAIL_DELIVERY_PROVIDER_PROFILES.find((item) => item.id === value); setCheckProvider(value as EmailDeliveryProviderId); if (provider && provider.id !== "GENERIC") setForm((previous) => ({ ...previous, host: provider.smtp.host, port: String(provider.smtp.port), security: provider.smtp.security, imapHost: provider.imap.host, imapPort: String(provider.imap.port), imapSecurity: provider.imap.security })); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{EMAIL_DELIVERY_PROVIDER_PROFILES.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}</SelectContent></Select></InputGroup>
        <InputGroup><InputGroupAddon align="block-start">Test recipient</InputGroupAddon><InputGroupInput type="email" required value={checkRecipient} placeholder="you@example.com" disabled={testing || pending} onChange={event => setCheckRecipient(event.target.value)} /></InputGroup>
        <Button type="submit" className="self-start" disabled={testing || pending || !saved || !checkRecipient.trim()}>{testing ? "Running checks…" : "Run checks"}</Button>
        {checkMessage && <p role="status" aria-live="polite" className="text-sm">{checkMessage}</p>}
      </form>}
    </SectionShell>}
    <TemplateList templates={data.templates} canEdit={data.canEditTemplates} scopedRole={data.scopedRole} emailOnly
      onReload={() => startTransition(async () => {
        const next = await getEmailSectionData();
        if (next.ok) setData(next);
      })} />
  </div>;
}
