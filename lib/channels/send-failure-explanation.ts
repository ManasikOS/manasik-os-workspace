/**
 * Turns a failed Messenger / Instagram send into one sentence a member of staff can act on, shown in the
 * conversation when the assistant's reply could not be delivered. Without it the failure was logged and the
 * conversation simply stayed silent — "the AI didn't answer" with no way to see why.
 *
 * Only Meta's own explanation and our fixed wording are used: never the request, the token, or anything the
 * customer wrote.
 */

import { MetaGraphError, describeMetaError } from "@/lib/meta/graph";

const MAX_META_TEXT = 200;

export function explainSendFailure(error: unknown, errorClass: string): string {
  const metaMessage = error instanceof MetaGraphError ? describeMetaError(error.body) : undefined;

  // The app is in Development mode: Meta only delivers to people with a role on it. The commonest first-test failure.
  if (metaMessage && /not admins, developers or testers/i.test(metaMessage)) {
    return "Meta will only deliver to people who have a role on your Meta app while it is in Development mode. Add this customer's Facebook or Instagram account under App roles → Testers, or make the app Live once pages_messaging is approved.";
  }
  if (errorClass === "OUTSIDE_SERVICE_WINDOW") {
    return "The customer's last message is more than 24 hours old, and Meta does not allow a reply after that. Reply once they message again.";
  }
  if (metaMessage) return `Meta said: ${metaMessage.slice(0, MAX_META_TEXT)}`;
  return "Meta did not accept the message. Check the connection under Settings → Integrations.";
}
