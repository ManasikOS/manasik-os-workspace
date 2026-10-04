import type { InboxView } from "./views";

export interface EmptyViewCopy {
  title: string;
  hint: string;
}

const NOTHING_HERE_HINT = "New conversations that fit this queue will appear here on their own.";

/** What an empty queue says: what it is for and why nothing is in it, never a bare "no results". Exhaustive by type. */
const EMPTY_VIEW_COPY: Record<InboxView, EmptyViewCopy> = {
  all: { title: "No open conversations", hint: "When a customer writes in, the chat will appear here." },
  unassigned: { title: "Every chat has an owner", hint: "Chats nobody owns yet will appear here." },
  "assigned-to-me": { title: "Nothing is assigned to you", hint: "Chats given to you, or ones you take over, will appear here." },
  whatsapp: { title: "No WhatsApp chats", hint: NOTHING_HERE_HINT },
  instagram: { title: "No Instagram chats", hint: NOTHING_HERE_HINT },
  messenger: { title: "No Messenger chats", hint: NOTHING_HERE_HINT },
  email: { title: "No email conversations", hint: NOTHING_HERE_HINT },
  closed: { title: "No closed conversations", hint: "Chats you close will be kept here." },
  spam: { title: "No spam", hint: "Chats marked as spam will be kept here, and can be restored." },
  "needs-reply": { title: "No one is waiting for a reply", hint: "Chats where the customer wrote last will appear here." },
  "waiting-customer": { title: "No chats waiting on customers", hint: "Chats where you replied last will appear here." },
  "waiting-team": { title: "No chats waiting on the team", hint: NOTHING_HERE_HINT },
  payments: { title: "No payment conversations", hint: NOTHING_HERE_HINT },
  documents: { title: "No document conversations", hint: NOTHING_HERE_HINT },
  visa: { title: "No visa conversations", hint: NOTHING_HERE_HINT },
  complaints: { title: "No complaints", hint: NOTHING_HERE_HINT },
  escalations: { title: "No escalations", hint: NOTHING_HERE_HINT },
  "nearing-deadline": { title: "Nothing is close to its reply deadline", hint: NOTHING_HERE_HINT },
  overdue: { title: "Nothing is overdue", hint: "Chats that missed their reply deadline will appear here." },
  "new-enquiries": { title: "No new enquiries", hint: NOTHING_HERE_HINT },
  qualified: { title: "No qualified leads", hint: NOTHING_HERE_HINT },
  "ready-to-book": { title: "No chats ready to book", hint: NOTHING_HERE_HINT },
  "quote-sent": { title: "No quotes awaiting an answer", hint: NOTHING_HERE_HINT },
};

export function emptyViewCopy(view: InboxView): EmptyViewCopy {
  return EMPTY_VIEW_COPY[view];
}
