"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { saveSmtpSettings, sendSmtpTestEmail } from "@/app/(main)/management/settings/email/actions";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SmtpSecurity = "STARTTLS" | "TLS";
type FormMessage = { ok: boolean; text: string } | null;

/**
 * Email (SMTP) inside the setup card: save the server details, then send a test
 * email to confirm they work. Reuses the Settings actions, so the same checks,
 * encryption and access rules apply and the values show up in Settings → Email.
 */
export function SetupSmtpForm({ alreadySaved }: { alreadySaved: boolean }) {
  const [saved, setSaved] = useState(alreadySaved);
  const [form, setForm] = useState({
    host: "",
    port: "587",
    security: "STARTTLS" as SmtpSecurity,
    username: "",
    password: "",
    fromName: "",
    fromEmail: "",
    replyTo: "",
  });
  const [testRecipient, setTestRecipient] = useState("");
  const [saveMessage, setSaveMessage] = useState<FormMessage>(null);
  const [testMessage, setTestMessage] = useState<FormMessage>(null);
  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();

  const updateField = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    setSaveMessage(null);
    startSaving(async () => {
      try {
        const result = await saveSmtpSettings(form);
        if (result.ok) {
          setSaved(true);
          setForm((previous) => ({ ...previous, password: "" }));
          setSaveMessage({ ok: true, text: "Saved. Send a test email below to make sure it works." });
        } else {
          setSaveMessage({ ok: false, text: result.error ?? "We couldn't save these settings." });
        }
      } catch {
        setSaveMessage({ ok: false, text: "We couldn't save these settings. Please try again." });
      }
    });
  };

  const handleTest = (event: React.FormEvent) => {
    event.preventDefault();
    setTestMessage(null);
    startTesting(async () => {
      try {
        const result = await sendSmtpTestEmail(testRecipient);
        setTestMessage({ ok: Boolean(result.ok), text: (result.ok ? result.message : result.error) ?? "Test finished." });
      } catch {
        setTestMessage({ ok: false, text: "We couldn't complete the test. Please try again." });
      }
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-5 border-t pt-4">
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Mail server</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={form.host} onChange={updateField("host")} placeholder="smtp.example.com" required autoComplete="off" />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Port</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="number" value={form.port} onChange={updateField("port")} required />
        </InputGroup>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Encryption</span>
          <Select
            value={form.security}
            onValueChange={(value) => setForm((previous) => ({ ...previous, security: value as SmtpSecurity }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="STARTTLS">STARTTLS (usually port 587)</SelectItem>
              <SelectItem value="TLS">SSL/TLS (usually port 465)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Username</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={form.username} onChange={updateField("username")} placeholder="you@example.com" required autoComplete="off" />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Password</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            type="password"
            value={form.password}
            onChange={updateField("password")}
            placeholder={saved ? "Leave blank to keep the saved password" : "Password or app password"}
            required={!saved}
            autoComplete="new-password"
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Sender name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={form.fromName} onChange={updateField("fromName")} placeholder="Al-Noor Travels" />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Sender email</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput type="email" value={form.fromEmail} onChange={updateField("fromEmail")} placeholder="bookings@example.com" required />
        </InputGroup>
        <p className="text-xs text-muted-foreground">Your password is stored encrypted and never shown again.</p>
        {saveMessage && (
          <p role={saveMessage.ok ? "status" : "alert"} className={saveMessage.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
            {saveMessage.text}
          </p>
        )}
        <Button type="submit" className="self-start" disabled={isSaving || isTesting}>
          {isSaving && <Loader2Icon className="animate-spin" />} Save email settings
        </Button>
      </form>

      {saved && (
        <form onSubmit={handleTest} className="flex flex-col gap-3 border-t pt-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Send a test email to</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="email"
              value={testRecipient}
              onChange={(event) => setTestRecipient(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </InputGroup>
          {testMessage && (
            <p role={testMessage.ok ? "status" : "alert"} className={testMessage.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
              {testMessage.text}
            </p>
          )}
          <Button type="submit" variant="outline" className="self-start" disabled={isSaving || isTesting}>
            {isTesting && <Loader2Icon className="animate-spin" />} Send test email
          </Button>
        </form>
      )}
    </div>
  );
}
