import { inboxListMessagePreview } from "@/lib/inbox/message-preview";

/** The few fields of a stored message the popup shows. Internal notes, risk and AI metadata never reach the popup. */
export interface QuickChatMessage {
  id: string;
  direction: "IN" | "OUT";
  text: string;
  createdAt: string;
  deliveryStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  deliveryError: string | null;
  /** Who wrote an outgoing message: a colleague's name, the assistant, or null for the customer. */
  author: string | null;
}

export interface QuickChatMessageSource {
  id: string;
  role: string;
  actor_kind: string;
  actor_name_snapshot: string | null;
  content: string | null;
  message_type: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  created_at: string;
}

const DELIVERY = new Set(["PENDING", "SENT", "DELIVERED", "READ", "FAILED"]);

/** Chronological, customer and staff/assistant messages only. System and tool rows are not part of the conversation the customer sees. */
export function toQuickChatThread(rows: readonly QuickChatMessageSource[]): QuickChatMessage[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant" || row.role === "staff")
    .map((row): QuickChatMessage => {
      const incoming = row.role === "user";
      return {
        id: row.id,
        direction: incoming ? "IN" : "OUT",
        text: inboxListMessagePreview({ content: row.content, messageType: row.message_type }),
        createdAt: row.created_at,
        deliveryStatus:
          !incoming && row.delivery_status && DELIVERY.has(row.delivery_status)
            ? (row.delivery_status as QuickChatMessage["deliveryStatus"])
            : null,
        deliveryError: incoming ? null : row.delivery_error,
        author: incoming ? null : row.actor_kind === "AI" ? "Assistant" : row.actor_name_snapshot?.trim() || "Staff",
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
