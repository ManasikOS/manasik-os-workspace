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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          Templates are how you message a customer outside the 24-hour reply window — order updates, reminders, and
          marketing. Every template needs Meta&apos;s approval before it can be sent.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
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
                    <InputGroup>
                      <InputGroupAddon align="block-start"><InputGroupText>Name</InputGroupText></InputGroupAddon>
                      <InputGroupInput id="wat-name" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. departure_reminder" />
                    </InputGroup>
                    <InputGroup>
                      <InputGroupAddon align="block-start"><InputGroupText>Language</InputGroupText></InputGroupAddon>
                      <InputGroupInput id="wat-lang" aria-label="Template language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
                    </InputGroup>
                  </div>
                  <InputGroup>
                    <InputGroupAddon align="block-start"><InputGroupText>Category</InputGroupText></InputGroupAddon>
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
                  </InputGroup>
                  <InputGroup>
                    <InputGroupAddon align="block-start"><InputGroupText>Header (optional)</InputGroupText></InputGroupAddon>
                    <InputGroupInput id="wat-header" aria-label="Template header" value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Short header text" />
                  </InputGroup>
                  <InputGroup>
                    <InputGroupAddon align="block-start"><InputGroupText>Body</InputGroupText></InputGroupAddon>
                    <InputGroupTextarea
                      id="wat-body"
                      aria-label="Template body"
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      placeholder="Hi {{1}}, your departure to Makkah on {{2}} is confirmed."
                      rows={4}
                    />
                  </InputGroup>
                  <p className="text-[11px] text-muted-foreground">Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… for variables filled in at send time.</p>
                  <InputGroup>
                    <InputGroupAddon align="block-start"><InputGroupText>Footer (optional)</InputGroupText></InputGroupAddon>
                    <InputGroupInput id="wat-footer" aria-label="Template footer" value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Royal Al-Fathima Travels" />
                  </InputGroup>
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
        <div className="overflow-x-auto">
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
        </div>
      )}
    </div>
  );
}
