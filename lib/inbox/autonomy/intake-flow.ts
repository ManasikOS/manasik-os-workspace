import { findIntakeDenyTopic } from "./intake-deny-topics";

export const INTAKE_STEPS = ["DATES", "DEPARTURE_CITY", "ROOM_ARRANGEMENT", "PASSPORT_READINESS", "HUMAN_REVIEW"] as const;
export type IntakeStep = (typeof INTAKE_STEPS)[number];

export interface IntakeState { step: IntakeStep; answers: Partial<Record<Exclude<IntakeStep, "HUMAN_REVIEW">, string>>; stalledTurns: number }
export interface IntakeTransition { state: IntakeState; replyKey: string | null; handover: boolean; summary: string }

const MONTH_NAME = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/iu;
/** A first message that already volunteers a travel period, so the DATES question would be redundant. English only: a Sinhala/Tamil-only date mention is not lost, it just gets asked once, which is safe rather than a bug. */
const DATE_MENTION = new RegExp(`${MONTH_NAME.source}|\\b(next|this|early|late|mid) (month|year)\\b|\\b\\d{1,2}[/-]\\d{1,2}([/-]\\d{2,4})?\\b`, "iu");

function hasDateMention(text: string): boolean {
  return DATE_MENTION.test(text);
}

/**
 * One deterministic transition, applied identically to every customer message including the first — FIX4
 * (docs/inbox/fixing-plan.md): no automated reply is composed before this runs, whatever step the form is on.
 *
 * `isFirstTurn` changes only how a non-empty, non-deny-topic message is read: on the first turn nothing has been
 * asked yet, so the message is the trigger that started the intake, not necessarily an answer to "what dates
 * suit you" — it is only treated as answering DATES when it actually names a period; otherwise DATES is still
 * asked, instead of the raw greeting being stored as if it were a date. Every later turn is a direct reply to a
 * specific question already asked, so it is always taken as that question's answer, as before.
 */
export function advanceIntakeFlow(state: IntakeState, customerText: string, options: { isFirstTurn?: boolean } = {}): IntakeTransition {
  const denyTopic = findIntakeDenyTopic(customerText);
  if (denyTopic) return { state: { ...state, step: "HUMAN_REVIEW" }, replyKey: null, handover: true, summary: `Handover requested at ${state.step} (${denyTopic.label}); collected ${Object.keys(state.answers).join(", ") || "no answers"}.` };
  if (!customerText.trim()) {
    const stalledTurns = state.stalledTurns + 1;
    return stalledTurns >= 2
      ? { state: { ...state, step: "HUMAN_REVIEW", stalledTurns }, replyKey: null, handover: true, summary: "The intake stalled twice and needs a person to continue." }
      : { state: { ...state, stalledTurns }, replyKey: `ASK_${state.step}`, handover: false, summary: "" };
  }
  if (state.step === "HUMAN_REVIEW") return { state, replyKey: null, handover: true, summary: "Human review is required." };
  if (options.isFirstTurn && state.step === "DATES" && !hasDateMention(customerText)) {
    // The opening message names no period: ask DATES for real, rather than filing the greeting itself as the answer.
    return { state, replyKey: `ASK_${state.step}`, handover: false, summary: "" };
  }
  const nextIndex = Math.min(INTAKE_STEPS.indexOf(state.step) + 1, INTAKE_STEPS.length - 1);
  const answers = { ...state.answers, [state.step]: customerText.trim() };
  const next = INTAKE_STEPS[nextIndex];
  return { state: { step: next, answers, stalledTurns: 0 }, replyKey: next === "HUMAN_REVIEW" ? null : `ASK_${next}`, handover: next === "HUMAN_REVIEW", summary: next === "HUMAN_REVIEW" ? "Intake complete; a person must review before any offer or booking." : "" };
}

const INTAKE_QUESTIONS = {
  en: {
    ASK_DATES: "What travel dates or month would suit you?",
    ASK_DEPARTURE_CITY: "Which city would you prefer to depart from?",
    ASK_ROOM_ARRANGEMENT: "What room arrangement do you need: quad, triple, double, or single?",
    ASK_PASSPORT_READINESS: "Are the travellers' passports ready? Please answer only ready, renewing, or not yet.",
  },
  si: {
    ASK_DATES: "ඔබට ගැළපෙන ගමන් දිනය හෝ මාසය කුමක්ද?",
    ASK_DEPARTURE_CITY: "ඔබ පිටත්වීමට කැමති නගරය කුමක්ද?",
    ASK_ROOM_ARRANGEMENT: "ඔබට අවශ්‍ය කාමර වර්ගය කුමක්ද: හතර දෙනා, තුන්දෙනා, දෙදෙනා හෝ තනි?",
    ASK_PASSPORT_READINESS: "සංචාරකයින්ගේ විදේශ ගමන් බලපත්‍ර සූදානම්ද? සූදානම්, අලුත් කරමින්, හෝ තවම නැත යනුවෙන් පිළිතුරු දෙන්න.",
  },
  ta: {
    ASK_DATES: "உங்களுக்கு ஏற்ற பயண தேதி அல்லது மாதம் எது?",
    ASK_DEPARTURE_CITY: "எந்த நகரத்திலிருந்து புறப்பட விரும்புகிறீர்கள்?",
    ASK_ROOM_ARRANGEMENT: "எந்த அறை அமைப்பு வேண்டும்: நான்கு, மூன்று, இரண்டு அல்லது தனி?",
    ASK_PASSPORT_READINESS: "பயணிகளின் கடவுச்சீட்டுகள் தயாரா? தயார், புதுப்பிக்கப்படுகிறது, அல்லது இன்னும் இல்லை என்று பதிலளிக்கவும்.",
  },
} as const;

export function intakeQuestion(replyKey: string, customerText: string): string | null {
  const language = /[\u0D80-\u0DFF]/u.test(customerText) ? "si" : /[\u0B80-\u0BFF]/u.test(customerText) ? "ta" : "en";
  return INTAKE_QUESTIONS[language][replyKey as keyof (typeof INTAKE_QUESTIONS)["en"]] ?? null;
}
