/**
 * Flags documents that state money amounts. The assistant must never quote a price from a document
 * (prices come from the live departure tools only — §4 of the knowledge base plan), so staff are
 * told at upload time. Detection only; the text is never altered.
 */

const CURRENCY_CODE = "(?:LKR|USD|SAR|EUR|GBP|AED|INR|Rs\\.?|Rupees?)";
const CURRENCY_SYMBOL = "[$€£]";

// "LKR 15,000", "Rs. 2500", "USD 1,200.50", "$450", "15,000 LKR", "2500 rupees"
const AMOUNT_AFTER_CODE = new RegExp(`(?:\\b${CURRENCY_CODE}\\s*|${CURRENCY_SYMBOL}\\s*)\\d[\\d,]*(?:\\.\\d+)?`, "i");
const AMOUNT_BEFORE_CODE = new RegExp(`\\d[\\d,]*(?:\\.\\d+)?\\s*${CURRENCY_CODE}\\b`, "i");

export function containsCurrencyAmount(text: string): boolean {
  return AMOUNT_AFTER_CODE.test(text) || AMOUNT_BEFORE_CODE.test(text);
}
