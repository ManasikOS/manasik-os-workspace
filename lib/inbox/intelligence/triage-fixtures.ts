/**
 * 60 labelled inbound messages for the S1 triage tests — MI2.4 of docs/inbox/implementation-plan.md.
 * English, Sinhala, Tamil and mixed (Latin-script Sinhala, "Singlish") in equal-ish measure. The label is what an agency
 * staff member would say the customer wants. Test data only: nothing imports this at runtime.
 *
 * These fixtures measure the RULE reading (`triageByRules`) — the deterministic fallback that answers when the model
 * cannot. They say nothing about the model's own accuracy; that is measured live from `ai_runs` against staff corrections.
 */

import type { IntentCode } from "@/lib/inbox/intelligence/contracts";

export interface TriageFixture {
  text: string;
  intent: IntentCode;
  language: "en" | "si" | "ta";
}

export const TRIAGE_FIXTURES: readonly TriageFixture[] = [
  // ── English (30)
  { text: "Hi, do you have any Umrah packages for December?", intent: "PACKAGE_ENQUIRY", language: "en" },
  { text: "Assalamu alaikum, I'm looking for a Hajj package for my parents", intent: "PACKAGE_ENQUIRY", language: "en" },
  { text: "Interested in your Ramadan Umrah tour", intent: "PACKAGE_ENQUIRY", language: "en" },
  { text: "What is the price for the 14 day Umrah package?", intent: "PRICE_REQUEST", language: "en" },
  { text: "How much for 2 adults?", intent: "PRICE_REQUEST", language: "en" },
  { text: "Can you send the rate per person for a quad room?", intent: "PRICE_REQUEST", language: "en" },
  { text: "I want to book 2 seats for the March departure", intent: "BOOKING_REQUEST", language: "en" },
  { text: "Please register my family for the Umrah trip", intent: "BOOKING_REQUEST", language: "en" },
  { text: "Can you hold a seat for me until Friday?", intent: "BOOKING_REQUEST", language: "en" },
  { text: "I have already paid the advance yesterday", intent: "PAYMENT_CLAIM", language: "en" },
  { text: "Payment done, sending the bank slip now", intent: "PAYMENT_CLAIM", language: "en" },
  { text: "I transferred the money to your Commercial Bank account", intent: "PAYMENT_CLAIM", language: "en" },
  { text: "My passport photo was rejected, what should I do?", intent: "DOCUMENT_ISSUE", language: "en" },
  { text: "Which documents do I need to submit?", intent: "DOCUMENT_ISSUE", language: "en" },
  { text: "Sending the scanned copy of my passport", intent: "DOCUMENT_ISSUE", language: "en" },
  { text: "Has my visa been approved?", intent: "VISA_QUERY", language: "en" },
  { text: "How long does the visa take?", intent: "VISA_QUERY", language: "en" },
  { text: "What is the itinerary for the 10 day trip?", intent: "ITINERARY_QUERY", language: "en" },
  { text: "Which hotel will we stay in at Madinah?", intent: "ITINERARY_QUERY", language: "en" },
  { text: "This is unacceptable, nobody replied to my messages for 3 days", intent: "COMPLAINT", language: "en" },
  { text: "I am very disappointed with the service", intent: "COMPLAINT", language: "en" },
  { text: "I need to cancel my booking", intent: "CANCELLATION", language: "en" },
  { text: "Please refund my deposit", intent: "CANCELLATION", language: "en" },
  { text: "We are a group of 25 from our mosque", intent: "GROUP_ENQUIRY", language: "en" },
  { text: "Family of 6, planning Umrah in June", intent: "GROUP_ENQUIRY", language: "en" },
  { text: "What are your office hours?", intent: "FAQ", language: "en" },
  { text: "Can women travel without a mahram?", intent: "FAQ", language: "en" },
  { text: "Hello", intent: "OTHER", language: "en" },
  { text: "Congratulations! You've won a prize, click here http://bit.ly/x9 to claim it", intent: "SPAM", language: "en" },
  { text: "Earn $500 daily with crypto trading, guaranteed profit", intent: "SPAM", language: "en" },
  // ── Sinhala (10)
  { text: "උම්රා පැකේජ් එකක් ගැන දැනගන්න ඕන", intent: "PACKAGE_ENQUIRY", language: "si" },
  { text: "උම්රා එකට මිල කීයද?", intent: "PRICE_REQUEST", language: "si" },
  { text: "මම ගෙවුවා, රිසිට්පත එවන්නම්", intent: "PAYMENT_CLAIM", language: "si" },
  { text: "වීසා එක ලැබුණාද?", intent: "VISA_QUERY", language: "si" },
  { text: "මගේ ගමන් බලපත්‍රයේ පිටපත එවන්නද?", intent: "DOCUMENT_ISSUE", language: "si" },
  { text: "මට බුක් කරන්න ඕන", intent: "BOOKING_REQUEST", language: "si" },
  { text: "අපි කණ්ඩායමක් විදිහට එනවා, 15 දෙනෙක්", intent: "GROUP_ENQUIRY", language: "si" },
  { text: "මට අවලංගු කරන්න ඕන", intent: "CANCELLATION", language: "si" },
  { text: "ඔයාලා පිළිතුරක් නැහැ, මට කේන්තියි", intent: "COMPLAINT", language: "si" },
  { text: "හෝටලය කොහෙද තියෙන්නේ?", intent: "ITINERARY_QUERY", language: "si" },
  // ── Tamil (10)
  { text: "உம்ரா பேக்கேஜ் பற்றி தெரிந்து கொள்ள வேண்டும்", intent: "PACKAGE_ENQUIRY", language: "ta" },
  { text: "விலை எவ்வளவு?", intent: "PRICE_REQUEST", language: "ta" },
  { text: "நான் பணம் செலுத்தினேன்", intent: "PAYMENT_CLAIM", language: "ta" },
  { text: "விசா கிடைத்ததா?", intent: "VISA_QUERY", language: "ta" },
  { text: "என் பாஸ்போர்ட் ஸ்கேன் அனுப்பவா?", intent: "DOCUMENT_ISSUE", language: "ta" },
  { text: "எனக்கு பதிவு செய்ய வேண்டும்", intent: "BOOKING_REQUEST", language: "ta" },
  { text: "எங்கள் குழுவில் 20 பேர் இருக்கிறோம்", intent: "GROUP_ENQUIRY", language: "ta" },
  { text: "நான் ரத்து செய்ய வேண்டும்", intent: "CANCELLATION", language: "ta" },
  { text: "பதில் இல்லை, புகார் செய்கிறேன்", intent: "COMPLAINT", language: "ta" },
  { text: "ஹோட்டல் எங்கே இருக்கிறது?", intent: "ITINERARY_QUERY", language: "ta" },
  // ── Mixed / Latin-script Sinhala (10)
  { text: "umrah package ekak gana danaganna one", intent: "PACKAGE_ENQUIRY", language: "en" },
  { text: "December umrah eke price eka kiyada?", intent: "PRICE_REQUEST", language: "en" },
  { text: "mama advance eka gewwa, slip eka evannam", intent: "PAYMENT_CLAIM", language: "en" },
  { text: "visa eka awada?", intent: "VISA_QUERY", language: "en" },
  { text: "passport eka scan karala evannada", intent: "DOCUMENT_ISSUE", language: "en" },
  { text: "mata book karanna one 2 seats", intent: "BOOKING_REQUEST", language: "en" },
  { text: "api 12 denek inne, group booking ekak", intent: "GROUP_ENQUIRY", language: "en" },
  { text: "cancel karanna one, mage plan wenas una", intent: "CANCELLATION", language: "en" },
  { text: "oyalage service eka hari naha, reply ekak nane", intent: "COMPLAINT", language: "en" },
  { text: "Is the free breakfast included in the Umrah package? Saw it on https://fb.me/abc", intent: "PACKAGE_ENQUIRY", language: "en" },
];
