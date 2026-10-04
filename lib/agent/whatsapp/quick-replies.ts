/**
 * Which tappable reply buttons ride along with the assistant's reply. Deliberately deterministic, not
 * model-decided: the model can ask for a tool, but whether a shortcut button appears is derived from
 * which tool actually ran and succeeded this turn — the same "never trust the model with a business
 * decision" posture as the booking state machine itself. Pure, so it is unit tested.
 *
 * A tap arrives back as an ordinary message carrying the button's title (see extractMessageText in
 * lib/whatsapp/webhook-handler.ts), so the normal tool-calling loop handles it like a typed reply. That
 * means every title must read as a clear instruction on its own, and stay within WhatsApp's 20-character
 * limit.
 */

export interface QuickReply {
  id: string;
  title: string;
}

export interface QuickReplyToolCall {
  toolName: string;
  isError: boolean;
  resultSummary: string;
}

/**
 * Tools report ordinary failures ("no active booking", "departure no longer available") as a JSON body
 * starting with an `error` key, without marking the call itself as failed. A button must never appear
 * on top of one of those.
 */
export function toolCallSucceeded(call: QuickReplyToolCall): boolean {
  return !call.isError && !call.resultSummary.startsWith('{"error"');
}

export const BOOK_NOW_REPLY: QuickReply = { id: "action_book_now", title: "Book Now 📅" };
export const CONFIRM_BOOKING_REPLY: QuickReply = { id: "action_confirm_booking", title: "Confirm booking" };
export const CHANGE_DETAILS_REPLY: QuickReply = { id: "action_change_details", title: "Change details" };

/**
 * - Just showed one specific, still-available departure → "Book Now" (a shortcut into `start_booking`).
 * - Just showed the booking summary → "Confirm booking" / "Change details", so the customer can answer
 *   the confirmation question with a tap instead of typing.
 * Nothing when booking is switched off, when no tool ran, or when the last tool failed. Only the LAST
 * tool call counts, so a button never resurfaces once the conversation has moved on within the turn.
 */
export function chooseQuickReplies(input: { bookingEnabled: boolean; calls: readonly QuickReplyToolCall[] }): QuickReply[] {
  if (!input.bookingEnabled || input.calls.length === 0) return [];
  const last = input.calls[input.calls.length - 1];
  if (!toolCallSucceeded(last)) return [];

  if (last.toolName === "get_departure_details") return [BOOK_NOW_REPLY];
  if (last.toolName === "review_booking") return [CONFIRM_BOOKING_REPLY, CHANGE_DETAILS_REPLY];
  return [];
}
