/**
 * Pure helpers over an approved WhatsApp template's `components` (Meta's
 * template-definition shape, stored as-is in `whatsapp_templates.components`)
 * — no I/O, safe to import from client or server code. Used by the
 * Announcements compose UI and by the send-time dispatch to agree on how
 * many BODY variables one template needs.
 */

interface TemplateComponent {
  type?: string;
  text?: string;
}

/** Highest `{{n}}` placeholder index found in the template's BODY component text, or 0 if it has none. */
export function countBodyVariables(components: unknown): number {
  if (!Array.isArray(components)) return 0;
  const body = (components as TemplateComponent[]).find((c) => c?.type?.toUpperCase() === "BODY");
  if (!body?.text) return 0;

  let max = 0;
  for (const match of body.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max;
}

/** Builds the `components` payload for `sendTemplate()` — a single BODY text parameter when the template needs exactly one, nothing otherwise. */
export function buildTemplateSendComponents(components: unknown, bodyParam: string | null): unknown[] {
  return buildTemplateSendComponentsFromValues(components, bodyParam === null ? [] : [bodyParam]);
}

/** Builds a BODY parameter payload for templates with any number of variables. */
export function buildTemplateSendComponentsFromValues(components: unknown, bodyParams: string[]): unknown[] {
  const variableCount = countBodyVariables(components);
  if (variableCount === 0) return [];
  return [
    {
      type: "body",
      parameters: Array.from({ length: variableCount }, (_, index) => ({
        type: "text",
        text: bodyParams[index] ?? "",
      })),
    },
  ];
}

/** Human-readable snapshot stored with an outbound template message. */
export function renderTemplateText(components: unknown, bodyParams: string[]): string {
  if (!Array.isArray(components)) return "WhatsApp template message";

  const text = (components as TemplateComponent[])
    .filter((component) => ["HEADER", "BODY", "FOOTER"].includes(component?.type?.toUpperCase() ?? ""))
    .map((component) => component.text ?? "")
    .filter(Boolean)
    .join("\n\n");

  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, rawIndex: string) => {
    return bodyParams[Number(rawIndex) - 1] ?? `{{${rawIndex}}}`;
  }) || "WhatsApp template message";
}
