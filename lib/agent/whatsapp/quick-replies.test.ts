import { describe, expect, it } from "vitest";

import {
  BOOK_NOW_REPLY,
  CHANGE_DETAILS_REPLY,
  CONFIRM_BOOKING_REPLY,
  chooseQuickReplies,
  toolCallSucceeded,
  type QuickReplyToolCall,
} from "./quick-replies";

const ok = (toolName: string): QuickReplyToolCall => ({ toolName, isError: false, resultSummary: '{"groupName":"Umrah Ramadan"}' });
const softError = (toolName: string): QuickReplyToolCall => ({ toolName, isError: false, resultSummary: '{"error":"No active booking session found."}' });
const hardError = (toolName: string): QuickReplyToolCall => ({ toolName, isError: true, resultSummary: "boom" });

describe("toolCallSucceeded", () => {
  it("is false for a thrown error and for a tool that reported an error body", () => {
    expect(toolCallSucceeded(ok("review_booking"))).toBe(true);
    expect(toolCallSucceeded(softError("review_booking"))).toBe(false);
    expect(toolCallSucceeded(hardError("review_booking"))).toBe(false);
  });
});

describe("chooseQuickReplies", () => {
  it("offers Book Now after departure details are shown", () => {
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [ok("get_departure_details")] })).toEqual([BOOK_NOW_REPLY]);
  });

  it("offers Confirm booking and Change details after the booking summary", () => {
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [ok("record_traveller"), ok("review_booking")] })).toEqual([
      CONFIRM_BOOKING_REPLY,
      CHANGE_DETAILS_REPLY,
    ]);
  });

  it("offers nothing when booking is off, nothing ran, or the last tool was something else", () => {
    expect(chooseQuickReplies({ bookingEnabled: false, calls: [ok("review_booking")] })).toEqual([]);
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [] })).toEqual([]);
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [ok("review_booking"), ok("get_booking_status")] })).toEqual([]);
  });

  it("offers nothing on top of a failed lookup, even one that did not throw", () => {
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [softError("get_departure_details")] })).toEqual([]);
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [softError("review_booking")] })).toEqual([]);
    expect(chooseQuickReplies({ bookingEnabled: true, calls: [hardError("review_booking")] })).toEqual([]);
  });

  it("keeps every button title within WhatsApp's 20-character limit", () => {
    for (const reply of [BOOK_NOW_REPLY, CONFIRM_BOOKING_REPLY, CHANGE_DETAILS_REPLY]) {
      expect([...reply.title].length).toBeLessThanOrEqual(20);
    }
  });
});
