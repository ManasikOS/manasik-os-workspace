/**
 * SalesContentGenerationService — template-based customer replies.
 *
 * Accepts only `CustomerSafeOffer` — a projection with no seat counts, fit
 * scores, readiness, supplier or margin fields — so internal data cannot
 * leak into a message by construction. `auditCustomerMessage()` is a second
 * line of defence, applied to template output and to any LLM rewrite: it
 * flags guarantees, visa promises, discounts, internal terms, and any figure
 * that is not in the confirmed package/group data.
 *
 * Sinhala and Tamil phrasing is a fixed phrasebook and should be reviewed by
 * a native speaker. Arabic is intentionally not offered (no product support).
 */

import { OCCUPANCY_LABELS, formatDateRange, formatShortDate, travellersLabel } from "./format";
import { formatMoney } from "./money";
import type {
  GeneratedReply,
  OfferMatch,
  ReplyIncludes,
  ReplyLanguage,
  ReplyPurpose,
  ReplyTone,
} from "./types";

/* ── Customer-safe projection ─────────────────────────────────────────────── */

export interface CustomerSafeOffer {
  groupName: string;
  packageName: string;
  departureDate: string;
  returnDate: string;
  durationDays: number;
  roomType: OfferMatch["roomType"];
  adults: number;
  children: number;
  infants: number;
  currency: string;
  pricePerPerson: number;
  totalPrice: number;
  depositPerPerson: number | null;
  totalDeposit: number | null;
  hotelStandard: string | null;
  majorInclusions: string[];
  paymentPlanSummary: string;
  supportsInstalments: boolean;
}

export function toCustomerSafeOffer(offer: OfferMatch): CustomerSafeOffer {
  return {
    groupName: offer.groupName,
    packageName: offer.packageName,
    departureDate: String(offer.departureDate),
    returnDate: String(offer.returnDate),
    durationDays: offer.durationDays,
    roomType: offer.roomType,
    adults: offer.adults,
    children: offer.children,
    infants: offer.infants,
    currency: offer.currency,
    pricePerPerson: offer.pricePerPerson,
    totalPrice: offer.totalPrice,
    depositPerPerson: offer.depositPerPerson ?? null,
    totalDeposit: offer.totalDeposit ?? null,
    hotelStandard: offer.hotelStandard ?? null,
    majorInclusions: offer.majorInclusions,
    paymentPlanSummary: offer.paymentPlanSummary,
    supportsInstalments: /instal|balance/i.test(offer.paymentPlanSummary),
  };
}

/* ── Phrasebook ───────────────────────────────────────────────────────────── */

interface Phrasebook {
  greeting: (name: string) => string;
  warmLine: string;
  intro: Record<ReplyPurpose, string>;
  noOffer: string;
  label: {
    dates: string;
    days: string;
    travellers: string;
    price: string;
    total: string;
    deposit: string;
    paymentPlan: string;
    hotel: string;
    inclusions: string;
    option: string;
    perPerson: string;
  };
  instalmentsAvailable: string;
  questionsIntro: string;
  availabilityNote: string;
  hotelNote: string;
  closing: string;
  shortClosing: string;
}

const PHRASEBOOK: Record<ReplyLanguage, Phrasebook> = {
  EN: {
    greeting: (name) => `Assalamu Alaikum ${name},`,
    warmLine: "I hope you and your family are well.",
    intro: {
      OFFER_RECOMMENDATION: "Thank you for your enquiry. Based on what you shared, this is the option we recommend:",
      PACKAGE_EXPLANATION: "Here are the details of the package you asked about:",
      PRICE_AND_ROOMS: "Here are the prices for your group:",
      INSTALMENT_PLAN: "Here is how the payment plan works for this package:",
      COMPARISON: "Here are the options side by side so you can compare:",
      DEPARTURE_DATE: "Here is the closest available departure for your preferred dates:",
      GENERAL: "Thank you for your message.",
    },
    noOffer: "We are checking the best available departure for your dates and will share the details shortly.",
    label: {
      dates: "Dates",
      days: "days",
      travellers: "Travellers",
      price: "Price",
      total: "Total",
      deposit: "Deposit",
      paymentPlan: "Payment plan",
      hotel: "Hotel",
      inclusions: "Includes",
      option: "Option",
      perPerson: "per person",
    },
    instalmentsAvailable: "Deposit on booking, with the balance in instalments before departure",
    questionsIntro: "To prepare an accurate quote, could you please confirm:",
    availabilityNote: "Seats are subject to availability until your booking is confirmed.",
    hotelNote: "Hotel names are confirmed closer to departure.",
    closing: "Please let us know if you have any questions. JazakAllahu khair.",
    shortClosing: "JazakAllahu khair.",
  },
  SI: {
    greeting: (name) => `අස්සලාමු අලෛකුම් ${name},`,
    warmLine: "ඔබ සහ ඔබේ පවුලේ අය සුවයෙන් සිටිනු ඇතැයි අපි විශ්වාස කරමු.",
    intro: {
      OFFER_RECOMMENDATION: "ඔබගේ විමසීමට ස්තූතියි. ඔබ ලබා දුන් තොරතුරු අනුව අප නිර්දේශ කරන විකල්පය මෙයයි:",
      PACKAGE_EXPLANATION: "ඔබ විමසූ පැකේජයේ විස්තර පහත දැක්වේ:",
      PRICE_AND_ROOMS: "ඔබගේ කණ්ඩායම සඳහා මිල ගණන් පහත දැක්වේ:",
      INSTALMENT_PLAN: "මෙම පැකේජයේ ගෙවීම් සැලැස්ම පහත දැක්වේ:",
      COMPARISON: "සැසඳීම සඳහා විකල්ප පහත දැක්වේ:",
      DEPARTURE_DATE: "ඔබ කැමති දිනයන්ට ආසන්නතම පිටත්වීම පහත දැක්වේ:",
      GENERAL: "ඔබගේ පණිවිඩයට ස්තූතියි.",
    },
    noOffer: "ඔබගේ දිනයන් සඳහා හොඳම පිටත්වීම අපි පරීක්ෂා කරමින් සිටින අතර ඉක්මනින් විස්තර ලබා දෙන්නෙමු.",
    label: {
      dates: "දිනයන්",
      days: "දින",
      travellers: "සංචාරකයින්",
      price: "මිල",
      total: "මුළු මුදල",
      deposit: "අත්තිකාරම් මුදල",
      paymentPlan: "ගෙවීම් සැලැස්ම",
      hotel: "හෝටලය",
      inclusions: "ඇතුළත් වේ",
      option: "විකල්පය",
      perPerson: "එක් අයෙකුට",
    },
    instalmentsAvailable: "වෙන්කිරීමේදී අත්තිකාරම් මුදල, ඉතිරි මුදල පිටත්වීමට පෙර වාරික වශයෙන්",
    questionsIntro: "නිවැරදි මිල ගණනක් සකස් කිරීමට කරුණාකර පහත කරුණු තහවුරු කරන්න:",
    availabilityNote: "ඔබගේ වෙන්කිරීම තහවුරු කරන තුරු ආසන ලබා ගත හැකි වීම මත රඳා පවතී.",
    hotelNote: "හෝටල් නම් පිටත්වීමට ආසන්නව තහවුරු කරනු ලැබේ.",
    closing: "තවත් ප්‍රශ්න ඇත්නම් කරුණාකර අපට දන්වන්න. ජසාකල්ලාහු ඛෛර්.",
    shortClosing: "ජසාකල්ලාහු ඛෛර්.",
  },
  TA: {
    greeting: (name) => `அஸ்ஸலாமு அலைக்கும் ${name},`,
    warmLine: "நீங்களும் உங்கள் குடும்பத்தினரும் நலமாக இருப்பீர்கள் என நம்புகிறோம்.",
    intro: {
      OFFER_RECOMMENDATION: "உங்கள் விசாரணைக்கு நன்றி. நீங்கள் பகிர்ந்த தகவல்களின் அடிப்படையில் நாங்கள் பரிந்துரைக்கும் விருப்பம் இது:",
      PACKAGE_EXPLANATION: "நீங்கள் கேட்ட பேக்கேஜின் விவரங்கள் கீழே உள்ளன:",
      PRICE_AND_ROOMS: "உங்கள் குழுவுக்கான விலைகள் கீழே உள்ளன:",
      INSTALMENT_PLAN: "இந்த பேக்கேஜின் கட்டண திட்டம் கீழே உள்ளது:",
      COMPARISON: "ஒப்பிட்டுப் பார்க்க விருப்பங்கள் கீழே உள்ளன:",
      DEPARTURE_DATE: "நீங்கள் விரும்பும் தேதிகளுக்கு மிக அருகிலுள்ள புறப்பாடு இது:",
      GENERAL: "உங்கள் செய்திக்கு நன்றி.",
    },
    noOffer: "உங்கள் தேதிகளுக்கான சிறந்த புறப்பாட்டை நாங்கள் சரிபார்த்து விரைவில் விவரங்களைப் பகிர்வோம்.",
    label: {
      dates: "தேதிகள்",
      days: "நாட்கள்",
      travellers: "பயணிகள்",
      price: "விலை",
      total: "மொத்தம்",
      deposit: "முன்பணம்",
      paymentPlan: "கட்டண திட்டம்",
      hotel: "ஹோட்டல்",
      inclusions: "உள்ளடங்கியவை",
      option: "விருப்பம்",
      perPerson: "ஒருவருக்கு",
    },
    instalmentsAvailable: "முன்பதிவின் போது முன்பணம், மீதியை புறப்பாட்டுக்கு முன் தவணைகளாக",
    questionsIntro: "சரியான விலைப்பட்டியலைத் தயாரிக்க, தயவுசெய்து பின்வருவனவற்றை உறுதிப்படுத்தவும்:",
    availabilityNote: "உங்கள் முன்பதிவு உறுதிசெய்யப்படும் வரை இருக்கைகள் கிடைப்பதைப் பொறுத்தது.",
    hotelNote: "ஹோட்டல் பெயர்கள் புறப்பாட்டுக்கு அருகில் உறுதிப்படுத்தப்படும்.",
    closing: "மேலும் கேள்விகள் இருந்தால் தயவுசெய்து தெரிவிக்கவும். ஜஸாகல்லாஹு ஹைர்.",
    shortClosing: "ஜஸாகல்லாஹு ஹைர்.",
  },
};

/**
 * Internal "missing information" lines → questions a customer can answer.
 * Internal-only findings (e.g. "Child price is not set for this group") have
 * no entry and are never shown to the customer.
 */
const CUSTOMER_QUESTIONS: { match: RegExp; text: Record<ReplyLanguage, string> }[] = [
  {
    match: /journey type/i,
    text: {
      EN: "Whether you are planning Umrah or Hajj",
      SI: "ඔබ සැලසුම් කරන්නේ උම්රා ද හජ් ද යන්න",
      TA: "நீங்கள் உம்ரா அல்லது ஹஜ் திட்டமிடுகிறீர்களா",
    },
  },
  {
    match: /departure (date|week)|travel month/i,
    text: {
      EN: "Your preferred departure date",
      SI: "ඔබ කැමති පිටත්වීමේ දිනය",
      TA: "நீங்கள் விரும்பும் புறப்பாடு தேதி",
    },
  },
  {
    match: /ramadan/i,
    text: {
      EN: "Your exact travel dates during Ramadan",
      SI: "රාමසාන් කාලයේ ඔබගේ නිශ්චිත ගමන් දිනයන්",
      TA: "ரமலானில் உங்கள் சரியான பயண தேதிகள்",
    },
  },
  {
    match: /number of travellers/i,
    text: {
      EN: "The number of travellers (adults, children and infants)",
      SI: "සංචාරකයින් ගණන (වැඩිහිටියන්, ළමුන් සහ ළදරුවන්)",
      TA: "பயணிகளின் எண்ணிக்கை (பெரியவர்கள், குழந்தைகள், கைக்குழந்தைகள்)",
    },
  },
  {
    match: /room occupancy/i,
    text: {
      EN: "Your preferred room type (quad, triple or double sharing)",
      SI: "ඔබ කැමති කාමර වර්ගය (හතර, තුන හෝ දෙදෙනා බෙදාගැනීම)",
      TA: "நீங்கள் விரும்பும் அறை வகை (நான்கு, மூன்று அல்லது இருவர் பகிர்வு)",
    },
  },
  {
    match: /budget/i,
    text: {
      EN: "Your approximate budget per person",
      SI: "එක් අයෙකුට ඔබගේ ආසන්න අයවැය",
      TA: "ஒருவருக்கான உங்கள் தோராயமான பட்ஜெட்",
    },
  },
  {
    match: /ages of the children|children are travelling/i,
    text: {
      EN: "Whether any children are travelling, and their ages",
      SI: "ළමුන් ගමන් කරන්නේද සහ ඔවුන්ගේ වයස",
      TA: "குழந்தைகள் பயணிக்கிறார்களா, அவர்களின் வயது",
    },
  },
];

export function customerQuestions(internal: readonly string[], language: ReplyLanguage): string[] {
  const out: string[] = [];
  for (const line of internal) {
    const hit = CUSTOMER_QUESTIONS.find((entry) => entry.match.test(line));
    if (hit && !out.includes(hit.text[language])) out.push(hit.text[language]);
  }
  return out;
}

/* ── Defaults per purpose (used by the dialog's toggles) ──────────────────── */

export function defaultIncludesFor(purpose: ReplyPurpose): ReplyIncludes {
  const base: ReplyIncludes = {
    group: true,
    dates: true,
    room: true,
    price: true,
    paymentPlan: false,
    inclusions: false,
    comparison: false,
    missingQuestions: true,
  };
  switch (purpose) {
    case "PACKAGE_EXPLANATION":
      return { ...base, inclusions: true, paymentPlan: true };
    case "PRICE_AND_ROOMS":
      return { ...base, paymentPlan: true };
    case "INSTALMENT_PLAN":
      return { ...base, paymentPlan: true, dates: false };
    case "COMPARISON":
      return { ...base, comparison: true };
    case "DEPARTURE_DATE":
      return { ...base, price: false, room: false };
    case "GENERAL":
      return { ...base, price: false, room: false, group: false, dates: false };
    default:
      return base;
  }
}

/* ── Safety audit ─────────────────────────────────────────────────────────── */

/** Every figure a customer message may legitimately contain. */
export function allowedFigures(offers: readonly CustomerSafeOffer[]): Set<number> {
  const figures = new Set<number>();
  const add = (value: number | null) => {
    if (value !== null && Number.isFinite(value)) figures.add(Math.round(value * 100) / 100);
  };
  for (const offer of offers) {
    [offer.pricePerPerson, offer.totalPrice, offer.depositPerPerson, offer.totalDeposit, offer.durationDays].forEach(add);
    [offer.departureDate, offer.returnDate].forEach((date) => add(Number(date.slice(0, 4))));
    for (const text of [offer.groupName, offer.packageName, offer.hotelStandard ?? "", ...offer.majorInclusions]) {
      for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) add(Number(match[0].replace(/,/g, "")));
    }
  }
  return figures;
}

export function auditCustomerMessage(text: string, allowed: Set<number>): string[] {
  const warnings: string[] = [];
  if (/guarantee/i.test(text)) warnings.push("Mentions a guarantee — seats are only secured by a confirmed booking.");
  if (/visa[^.\n]{0,30}(approv|guarant|assur)/i.test(text)) warnings.push("Implies visa approval — never promise a visa outcome.");
  if (/discount|%\s*off|special price|reduced price|offer price/i.test(text)) {
    warnings.push("Mentions a discount or special price that is not on record.");
  }
  if (/readiness|margin|supplier|broker|profit|fit score/i.test(text)) warnings.push("Mentions internal data.");
  for (const match of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ""));
    if (value >= 100 && !allowed.has(value)) {
      warnings.push(`Contains ${match[0]}, which is not in the package or group data.`);
    }
  }
  return [...new Set(warnings)];
}

/* ── Generation ───────────────────────────────────────────────────────────── */

export interface CustomerReplyInput {
  customerFirstName: string;
  purpose: ReplyPurpose;
  tone: ReplyTone;
  language: ReplyLanguage;
  include: ReplyIncludes;
  offer: CustomerSafeOffer | null;
  alternatives: CustomerSafeOffer[];
  /** Internal unanswered questions; only those with a customer phrasing are used. */
  internalQuestions: string[];
}

export interface SalesContentGenerationService {
  generate(input: CustomerReplyInput): GeneratedReply;
}

function offerLines(offer: CustomerSafeOffer, input: CustomerReplyInput, book: Phrasebook): string[] {
  const { include, tone } = input;
  const short = tone === "SHORT_WHATSAPP";
  const payers = offer.adults + offer.children;
  const lines: string[] = [];
  const dates = `${formatDateRange(offer.departureDate, offer.returnDate)} (${offer.durationDays} ${book.label.days})`;

  if (include.group) lines.push(short && include.dates ? `*${offer.groupName}* · ${dates}` : `*${offer.groupName}*`);
  if (include.dates && !(short && include.group)) lines.push(`${book.label.dates}: ${dates}`);
  if (include.room) {
    const room = offer.roomType ? ` · ${OCCUPANCY_LABELS[offer.roomType]}` : "";
    lines.push(`${book.label.travellers}: ${travellersLabel(offer.adults, offer.children, offer.infants)}${room}`);
  }
  if (include.price) {
    lines.push(
      short
        ? `${book.label.total}: ${formatMoney(offer.totalPrice, offer.currency)}`
        : `${book.label.price}: ${formatMoney(offer.pricePerPerson, offer.currency)} ${book.label.perPerson} · ${book.label.total}: ${formatMoney(offer.totalPrice, offer.currency)}`,
    );
  }
  if (include.paymentPlan || include.price) {
    if (offer.depositPerPerson !== null && offer.totalDeposit !== null) {
      lines.push(
        short
          ? `${book.label.deposit}: ${formatMoney(offer.totalDeposit, offer.currency)}`
          : `${book.label.deposit}: ${formatMoney(offer.depositPerPerson, offer.currency)} × ${payers} = ${formatMoney(offer.totalDeposit, offer.currency)}`,
      );
    }
  }
  if (include.paymentPlan) {
    const plan =
      input.language === "EN" ? offer.paymentPlanSummary : offer.supportsInstalments ? book.instalmentsAvailable : offer.paymentPlanSummary;
    lines.push(`${book.label.paymentPlan}: ${plan}`);
  }
  if (!short && offer.hotelStandard && (include.inclusions || tone === "DETAILED")) {
    lines.push(`${book.label.hotel}: ${offer.hotelStandard}`);
  }
  if (!short && include.inclusions && offer.majorInclusions.length > 0) {
    const limit = tone === "DETAILED" ? 8 : 4;
    lines.push(`${book.label.inclusions}:`);
    for (const item of offer.majorInclusions.slice(0, limit)) lines.push(`- ${item}`);
  }
  return lines;
}

export function generateCustomerReply(input: CustomerReplyInput): GeneratedReply {
  const book = PHRASEBOOK[input.language];
  const short = input.tone === "SHORT_WHATSAPP";
  const out: string[] = [book.greeting(input.customerFirstName)];
  if (input.tone === "WARM" || input.tone === "DETAILED") out.push(book.warmLine);
  out.push("", book.intro[input.purpose]);

  const showsOffer =
    input.include.group || input.include.dates || input.include.room || input.include.price || input.include.paymentPlan || input.include.inclusions;

  if (input.offer && showsOffer) {
    out.push("", ...offerLines(input.offer, input, book));
  } else if (!input.offer && input.purpose !== "GENERAL") {
    out.push("", book.noOffer);
  }

  if (input.include.comparison && input.alternatives.length > 0) {
    out.push("");
    const options = [input.offer, ...input.alternatives].filter((entry): entry is CustomerSafeOffer => entry !== null).slice(0, 3);
    options.forEach((option, index) => {
      const room = option.roomType ? ` · ${OCCUPANCY_LABELS[option.roomType]}` : "";
      out.push(
        `${book.label.option} ${index + 1}: ${option.packageName} · ${formatShortDate(option.departureDate)}–${formatShortDate(option.returnDate)}${room} · ${formatMoney(option.pricePerPerson, option.currency)} ${book.label.perPerson} (${book.label.total} ${formatMoney(option.totalPrice, option.currency)})`,
      );
    });
  }

  if (input.include.missingQuestions) {
    const questions = customerQuestions(input.internalQuestions, input.language).slice(0, short ? 2 : 3);
    if (questions.length > 0) {
      out.push("", book.questionsIntro, ...questions.map((question) => `- ${question}`));
    }
  }

  if (input.offer && showsOffer) {
    out.push("", book.availabilityNote);
    if (!short && input.offer.hotelStandard && (input.include.inclusions || input.tone === "DETAILED")) {
      out.push(book.hotelNote);
    }
  }

  out.push("", short ? book.shortClosing : book.closing);

  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const allowed = allowedFigures([input.offer, ...input.alternatives].filter((entry): entry is CustomerSafeOffer => entry !== null));
  return { text, source: "RULES", warnings: auditCustomerMessage(text, allowed) };
}

export const templateContentGeneration: SalesContentGenerationService = { generate: generateCustomerReply };
