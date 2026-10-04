"use client";

import { Languages } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { translateInboxTextAction } from "../actions";

export function InboxTranslationControl({ conversationId, messageId, label = "Translate" }: { conversationId: string; messageId?: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ translation: string; detectedLanguage: string; confidence: number; source: string; note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const translate = () => startTransition(async () => {
    setError(null);
    const next = await translateInboxTextAction({ conversationId, messageId, targetLanguage: "English" });
    if (!next.ok) setError(next.error);
    else setResult(next);
  });

  return (
    <div className="mt-1.5 max-w-[76%] self-start">
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={translate} disabled={pending}>
        <Languages className="mr-1 size-3" />{pending ? "Translating…" : label}
      </Button>
      {result && <p className="rounded border bg-background px-2 py-1.5 text-xs text-foreground">Non-authoritative English translation · {result.source === "LLM" ? "AI" : "Rules"} · {Math.round(result.confidence * 100)}% sure<br />{result.translation}</p>}
      {error && <p role="alert" className="text-[11px] text-muted-foreground">{error}</p>}
    </div>
  );
}
