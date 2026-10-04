/**
 * The labelled fixture set for the risk classifier — MI4.3 (forty customer messages). Test-only.
 *
 * `tier` says what the keyword lexicon is EXPECTED to make of the message on its own, so the tests can hold each path to account:
 *   STRONG      a phrase the lexicon is sure of: settled with no model call;
 *   WEAK        only a weak cue: the model is asked, and if it fails the cue is still reported;
 *   UNREADABLE  Sinhala or Tamil with no strong phrase: only a model can read it; if it fails the message is reported as unread;
 *   QUIET       ordinary: no cue, no model call, no signal;
 *   DECOY       ordinary but shaped like a concern ("help me choose a package"): the model may be asked, and must not flag it.
 * `distressed` marks a customer who is scared, stranded or in a medical emergency: the recall gate is measured over these.
 */

import type { RiskFlag } from "./classify";

export type FixtureTier = "STRONG" | "WEAK" | "UNREADABLE" | "QUIET" | "DECOY";

export interface RiskFixture {
  id: string;
  text: string;
  flags: RiskFlag[];
  tier: FixtureTier;
  distressed?: boolean;
}

export const RISK_FIXTURES: readonly RiskFixture[] = [
  // ── complaints ──
  { id: "complaint-1", text: "This is the worst service I have ever had. I will complain to the consumer affairs authority.", flags: ["COMPLAINT"], tier: "STRONG" },
  { id: "complaint-2", text: "We are very disappointed with your service, the hotel was nothing like what you promised.", flags: ["COMPLAINT"], tier: "STRONG" },
  { id: "complaint-3", text: "Nobody replied to my messages for three days and I am not happy about it.", flags: ["COMPLAINT"], tier: "WEAK" },
  { id: "complaint-4", text: "My lawyer will contact you about what happened on the trip.", flags: ["COMPLAINT"], tier: "STRONG" },
  { id: "complaint-5", text: "අපට ඔබේ සේවාව ගැන පැමිණිල්ලක් තියෙනවා", flags: ["COMPLAINT"], tier: "STRONG" },

  // ── fraud concerns ──
  { id: "fraud-1", text: "Is this a scam? My neighbour said your company is fake.", flags: ["FRAUD_CONCERN"], tier: "STRONG" },
  { id: "fraud-2", text: "How can I trust you with the advance payment?", flags: ["FRAUD_CONCERN"], tier: "STRONG" },
  { id: "fraud-3", text: "Someone told me to transfer money to a different account, is that from you?", flags: ["FRAUD_CONCERN"], tier: "STRONG" },
  { id: "fraud-4", text: "I am a bit suspicious about the payment link you sent, can you verify it is yours?", flags: ["FRAUD_CONCERN"], tier: "WEAK" },
  { id: "fraud-5", text: "இது மோசடியா என்று சொல்லுங்கள்", flags: ["FRAUD_CONCERN"], tier: "STRONG" },

  // ── medical urgency ──
  { id: "medical-1", text: "My father collapsed this morning and has chest pain, we are supposed to fly tomorrow.", flags: ["MEDICAL_URGENCY"], tier: "STRONG", distressed: true },
  { id: "medical-2", text: "She was rushed to the hospital last night and is unconscious.", flags: ["MEDICAL_URGENCY"], tier: "STRONG", distressed: true },
  { id: "medical-3", text: "My mother has diabetes and needs her insulin injection on the flight, is that okay?", flags: ["MEDICAL_URGENCY"], tier: "WEAK" },
  { id: "medical-4", text: "He has a high fever and pain today, we leave on Friday.", flags: ["MEDICAL_URGENCY"], tier: "WEAK", distressed: true },
  { id: "medical-5", text: "அப்பாவுக்கு மாரடைப்பு வந்துவிட்டது", flags: ["MEDICAL_URGENCY"], tier: "STRONG", distressed: true },

  // ── religious rulings ──
  { id: "ruling-1", text: "Is it permissible to break my ihram if I feel unwell?", flags: ["RELIGIOUS_RULING"], tier: "STRONG" },
  { id: "ruling-2", text: "Do I have to pay a dam if I cut my hair early?", flags: ["RELIGIOUS_RULING"], tier: "STRONG" },
  { id: "ruling-3", text: "What is the ruling on wearing a watch in ihram?", flags: ["RELIGIOUS_RULING"], tier: "STRONG" },
  { id: "ruling-4", text: "Our scholar said something different, can your ustad explain the rules of ihram?", flags: ["RELIGIOUS_RULING"], tier: "WEAK" },
  { id: "ruling-5", text: "මේක හරාම් ද කියලා කියන්න පුළුවන්ද", flags: ["RELIGIOUS_RULING"], tier: "STRONG" },

  // ── distress ──
  { id: "distress-1", text: "Please help me, I am stranded at the airport and nobody is answering.", flags: ["DISTRESS"], tier: "STRONG", distressed: true },
  { id: "distress-2", text: "I am desperate, I lost my passport and I don't know what to do.", flags: ["DISTRESS"], tier: "STRONG", distressed: true },
  { id: "distress-3", text: "We are scared, the driver has not come and it is very late.", flags: ["DISTRESS"], tier: "WEAK", distressed: true },
  { id: "distress-4", text: "I am worried, my group left without us and I am stuck at the hotel.", flags: ["DISTRESS"], tier: "STRONG", distressed: true },
  { id: "distress-5", text: "பயமாக இருக்கிறது, உதவி செய்யுங்கள்", flags: ["DISTRESS"], tier: "STRONG", distressed: true },
  { id: "distress-6", text: "අපිට ගොඩක් අමාරුයි, දැන්ම කවුරුහරි කතා කරන්න", flags: ["DISTRESS"], tier: "UNREADABLE", distressed: true },

  // ── ordinary messages ──
  { id: "routine-1", text: "Assalamu alaikum, do you have an Umrah package for December?", flags: [], tier: "QUIET" },
  { id: "routine-2", text: "How much is the 10 day package for three adults?", flags: [], tier: "QUIET" },
  { id: "routine-3", text: "Can I get the itinerary in PDF?", flags: [], tier: "QUIET" },
  { id: "routine-4", text: "Thank you, we will confirm by Monday.", flags: [], tier: "QUIET" },
  { id: "routine-5", text: "What time does the flight leave on the 12th?", flags: [], tier: "QUIET" },
  { id: "routine-6", text: "Do you have a quad room option near the Haram?", flags: [], tier: "QUIET" },
  { id: "routine-7", text: "We would like to add two more people to our booking.", flags: [], tier: "QUIET" },
  { id: "routine-8", text: "Is visa processing included in the package price?", flags: [], tier: "QUIET" },
  { id: "routine-9", text: "ඔබේ පැකේජ් මිල කීයද කියලා කියන්න පුළුවන්ද", flags: [], tier: "DECOY" },
  { id: "routine-10", text: "உங்கள் பேக்கேஜ் விலை என்ன என்று சொல்ல முடியுமா", flags: [], tier: "DECOY" },

  // ── decoys: shaped like a concern, but ordinary ──
  { id: "decoy-1", text: "Please help me choose between the 10 day and the 14 day package.", flags: [], tier: "DECOY" },
  { id: "decoy-2", text: "Is the hotel close to the Haram? I have an elderly mother.", flags: [], tier: "DECOY" },
  { id: "decoy-3", text: "Can I pay by card, and is it safe to pay online?", flags: [], tier: "DECOY" },
  { id: "decoy-4", text: "Do you provide a doctor or medicine on the trip in general?", flags: [], tier: "DECOY" },
];
