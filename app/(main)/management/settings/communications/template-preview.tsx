import { renderTemplatePreview } from "@/lib/data/settings-copy";

/** `[Preview with sample data]` — client-safe, no I/O. See the Settings plan §5.5. */
export function TemplatePreview({ body }: { body: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
      {renderTemplatePreview(body) || <span className="text-muted-foreground">Nothing to preview yet.</span>}
    </div>
  );
}
