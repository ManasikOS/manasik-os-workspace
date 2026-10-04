"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WhatsAppTemplateRow } from "@/lib/types/whatsapp";

import { createWhatsAppTemplate, deleteWhatsAppTemplate, syncTemplatesFromMeta } from "./actions";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "outline"> = {
  APPROVED: "default",
  PENDING: "outline",
  REJECTED: "destructive",
  PAUSED: "outline",
  DISABLED: "destructive",
};

export function TemplateManager({
  templates,
  canEdit,
  connected,
}: {
  templates: WhatsAppTemplateRow[];
  canEdit: boolean;
  connected: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");

  async function handleSync() {
    setBusy(true);
    setMessage(null);
    const result = await syncTemplatesFromMeta();
    setMessage(result.ok ? "Synced with Meta." : result.error);
    setBusy(false);
  }

  async function handleCreate() {
    setBusy(true);
    const result = await createWhatsAppTemplate({ name, language, category, headerText, bodyText, footerText });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setCreateOpen(false);
    setName("");
    setHeaderText("");
    setBodyText("");
    setFooterText("");
    setMessage("Template submitted to Meta for approval.");
  }

  async function handleDelete(t: WhatsAppTemplateRow) {
    setBusy(true);
    const result = await deleteWhatsAppTemplate(t.name, t.language);
    setMessage(result.ok ? "Template deleted." : result.error);
    setBusy(false);
  }

  if (!connected) {
    return <p className="text-sm text-muted-foreground">Connect WhatsApp under Integrations before managing templates.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Templates are how you message a customer outside the 24-hour reply window — order updates, reminders, and
          marketing. Every template needs Meta&apos;s approval before it can be sent.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" disabled={busy} onClick={handleSync}>
            Sync from Meta
          </Button>
          {canEdit && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger render={<Button size="sm">New Template</Button>} />
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>New WhatsApp template</DialogTitle>
                  <DialogDescription>Submitted directly to Meta. Approval usually takes a few minutes to a day.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium" htmlFor="wat-name">Name</label>
                      <Input id="wat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. departure_reminder" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium" htmlFor="wat-lang">Language</label>
                      <Input id="wat-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" htmlFor="wat-category">Category</label>
                    <Select
                      value={category}
                      onValueChange={(value) => setCategory(value as typeof category)}
                    >
                      <SelectTrigger id="wat-category" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTILITY">Utility — order/booking updates</SelectItem>
                        <SelectItem value="MARKETING">Marketing — promotions, offers</SelectItem>
                        <SelectItem value="AUTHENTICATION">Authentication — one-time codes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" htmlFor="wat-header">Header (optional)</label>
                    <Input id="wat-header" value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Short header text" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" htmlFor="wat-body">Body</label>
                    <Textarea
                      id="wat-body"
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      placeholder="Hi {{1}}, your departure to Makkah on {{2}} is confirmed."
                      rows={4}
                    />
                    <p className="text-[11px] text-muted-foreground">Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… for variables filled in at send time.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" htmlFor="wat-footer">Footer (optional)</label>
                    <Input id="wat-footer" value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Royal Al-Fathima Travels" />
                  </div>
                </div>
                <DialogFooter>
                  <Button disabled={busy || !name || !bodyText} onClick={handleCreate}>
                    Submit to Meta
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.language}</TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{t.status}</Badge>
                  {t.status === "REJECTED" && t.rejected_reason && (
                    <p className="text-[11px] text-destructive mt-1">{t.rejected_reason}</p>
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleDelete(t)}>
                      Delete
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
