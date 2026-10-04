export interface PassportCandidate { passportNumber?: string; expiryDate?: string; fullName?: string; confidence: number }

export interface PassportReviewTraveller { id: string; fullName: string; passportNumber: string | null }

export interface PassportReviewContext {
  travellers: PassportReviewTraveller[];
  departureDate: string | null;
  passportValidityMonths: number;
  selectedTravellerId?: string | null;
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/**
 * Reads the leading `YYYY-MM-DD` of a date, or null when it is not a real calendar date. The reading step hands over whatever text it
 * saw, so 31/12/2019, "15 Mar 2030" and 2030-02-30 all arrive here; none is guessed at, because a date that cannot be read cannot be
 * judged expired or valid.
 */
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value.trim().slice(0, 10) ? date : null;
}

function addMonths(date: string, months: number): string | null {
  const value = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) return null;
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

export function reviewPassportCandidate(candidate: PassportCandidate, context: PassportReviewContext, now: Date): {
  reviewRequired: boolean;
  expired: boolean;
  insufficientValidityAtDeparture: boolean;
  uncertainFields: string[];
  fieldMismatches: string[];
  candidateTravellerIds: string[];
  matchedTravellerId: string | null;
  travellerSelectionRequired: boolean;
  signal: "PASSPORT_EXPIRY_RISK" | null;
} {
  const expiry = candidate.expiryDate ? parseIsoDate(candidate.expiryDate) : null;
  const expiryUnreadable = Boolean(candidate.expiryDate) && expiry === null;
  const uncertainFields = ["passportNumber", "expiryDate", "fullName"].filter(
    (key) => !candidate[key as keyof PassportCandidate] || candidate.confidence < 0.9 || (key === "expiryDate" && expiryUnreadable),
  );
  const expired = expiry !== null && expiry.getTime() < now.getTime();
  const validUntil = context.departureDate ? addMonths(context.departureDate, context.passportValidityMonths) : null;
  const insufficientValidityAtDeparture = Boolean(expiry && validUntil && expiry.toISOString().slice(0, 10) < validUntil);
  const candidatePassport = normalise(candidate.passportNumber);
  const candidateName = normalise(candidate.fullName);
  const matches = context.travellers.filter((traveller) =>
    (candidatePassport && normalise(traveller.passportNumber) === candidatePassport) || (candidateName && normalise(traveller.fullName) === candidateName),
  );
  const selected = context.selectedTravellerId ? context.travellers.find((traveller) => traveller.id === context.selectedTravellerId) ?? null : null;
  const matchedTraveller = selected ?? (matches.length === 1 ? matches[0] : null);
  const fieldMismatches = matchedTraveller
    ? [
        ...(candidatePassport && matchedTraveller.passportNumber && normalise(matchedTraveller.passportNumber) !== candidatePassport ? ["passportNumber"] : []),
        ...(candidateName && normalise(matchedTraveller.fullName) !== candidateName ? ["fullName"] : []),
      ]
    : [];
  const candidateTravellerIds = (matches.length > 0 ? matches : context.travellers).map((traveller) => traveller.id);
  const travellerSelectionRequired = !matchedTraveller && candidateTravellerIds.length > 1;
  const reviewRequired = expired || insufficientValidityAtDeparture || uncertainFields.length > 0 || fieldMismatches.length > 0 || !matchedTraveller;
  return {
    reviewRequired,
    expired,
    insufficientValidityAtDeparture,
    uncertainFields,
    fieldMismatches,
    candidateTravellerIds,
    matchedTravellerId: matchedTraveller?.id ?? null,
    travellerSelectionRequired,
    signal: expired || insufficientValidityAtDeparture ? "PASSPORT_EXPIRY_RISK" : null,
  };
}
