/**
 * Turns the agency's conversation-style settings into prompt instructions. Pure and deterministic, so the
 * same settings always produce the same text (the prompt is cached on it) and the mapping is unit-tested.
 */

import {
  ENQUIRY_QUESTION_OPTIONS,
  PACKAGE_DETAIL_OPTIONS,
  type AiBehaviour,
} from "@/lib/validations/ai-behaviour";

const detailLabel = (key: string) => PACKAGE_DETAIL_OPTIONS.find((option) => option.key === key)?.label.toLowerCase() ?? key;
const questionLabel = (key: string) => ENQUIRY_QUESTION_OPTIONS.find((option) => option.key === key)?.label.toLowerCase() ?? key;

function lengthRule(length: AiBehaviour["replyLength"]): string {
  switch (length) {
    case "SHORT":
      return "Keep every reply to one to three short sentences.";
    case "DETAILED":
      return "You may write fuller replies when the customer asks for detail, but stay easy to read on a phone.";
    default:
      return "Keep replies short and clear: a few sentences, never a wall of text.";
  }
}

function emojiRule(level: AiBehaviour["emoji"]): string {
  switch (level) {
    case "NONE":
      return "Do not use emoji.";
    case "FREE":
      return "You may use emoji freely where they fit.";
    default:
      return "Use at most one emoji in a reply, and only when it feels natural.";
  }
}

const SHOW_FIRST_NOTE =
  "Do this straight away: call the departures tool at once (use 1 traveller if you do not know the number yet) and show the result in the same reply, then ask your questions afterwards.";

const GROUNDED_NOTE =
  "Only mention a detail if it is in the tool result; if the agency has not entered something (for example hotels or flights), leave it out and never invent it.";

function packageRule(behaviour: AiBehaviour): string {
  const shown = behaviour.detailsToShow.length > 0 ? behaviour.detailsToShow.map(detailLabel).join(", ") : "the essentials";

  switch (behaviour.packageEnquiry) {
    case "ASK_FIRST": {
      const firstQuestions = behaviour.questionsToAsk.slice(0, 2).map(questionLabel).join(" and ") || "how many are travelling";
      return `When a customer asks about packages, do NOT list packages yet. First ask for what you need to narrow it down (${firstQuestions}), then show only matching departures. When you do show one, include: ${shown}. ${GROUNDED_NOTE}`;
    }
    case "SHORT_SUMMARY":
      return `When a customer asks about packages, give a short summary of each open departure (name, dates and the starting price only) and ask which one they want to know more about. Give the rest (${shown}) only when they pick one or ask. ${SHOW_FIRST_NOTE} ${GROUNDED_NOTE}`;
    default:
      return `When a customer asks about packages, show each open departure with: ${shown}. ${SHOW_FIRST_NOTE} ${GROUNDED_NOTE}`;
  }
}

function questionRule(behaviour: AiBehaviour): string {
  if (behaviour.questionsToAsk.length === 0) {
    return "Do not interrogate the customer; only ask a question when you need the answer to help them.";
  }
  const list = behaviour.questionsToAsk.map(questionLabel).join(", then ");
  const pace = behaviour.oneQuestionAtATime
    ? "Ask one question per message and wait for the answer."
    : "You may ask for two related things in one message, but never more.";
  return `To register an enquiry, find out, in this order and skipping anything they already told you: ${list}. ${pace}`;
}

function handoffRule(handoff: AiBehaviour["handoff"]): string {
  switch (handoff) {
    case "WHEN_ASKED":
      return "Hand over to a staff member only when the customer asks for a person, or for something you cannot handle. Otherwise keep helping.";
    case "OFFER_ALWAYS":
      return "After answering, always mention that a staff member can take over if they would like to talk to a person.";
    default:
      return "Once you have the details above, tell the customer a staff member will follow up, and hand the conversation over.";
  }
}

export function renderBehaviourInstructions(behaviour: AiBehaviour): string {
  const lines = [
    "How to talk to customers (set by the agency; follow these over your own defaults):",
    `- ${lengthRule(behaviour.replyLength)}`,
    `- ${emojiRule(behaviour.emoji)}`,
    behaviour.format === "PLAIN"
      ? "- Write in plain sentences. Do not use bullet lists or bold."
      : "- Use short bullet lines for lists such as prices; WhatsApp bold (*text*) is fine for key facts.",
    `- ${packageRule(behaviour)}`,
    `- ${questionRule(behaviour)}`,
    `- ${handoffRule(behaviour.handoff)}`,
    behaviour.greeting &&
      `- When a customer first says hello, open with this message (you may adjust it lightly to the language they write in): "${behaviour.greeting}"`,
    behaviour.closing && `- When you hand over or finish an enquiry, close with: "${behaviour.closing}"`,
    behaviour.extraRules && `- Also: ${behaviour.extraRules}`,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}
