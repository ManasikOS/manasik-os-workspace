/**
 * The assistant does not answer a spam chat. Spam is the contract in docs/inbox/spam-state-contract.md: the conversation's own
 * lifecycle is SPAM, or its linked lead's stage is SPAM. Without this rule a customer marked as spam still got an automatic reply
 * to every later message, which defeats the point of marking it.
 */

export interface SpamFacts {
  lifecycleStatus: string | null | undefined;
  /** The linked lead's stage, or null when the chat has no lead. */
  leadStage: string | null | undefined;
}

export function isSpamConversation(facts: SpamFacts): boolean {
  return facts.lifecycleStatus === "SPAM" || facts.leadStage === "SPAM";
}
