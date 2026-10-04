import { describe, expect, it } from "vitest";

import { getChannelProfile } from "@/lib/channels/profile";

import { renderFrozenPreamble } from "./preamble";

/**
 * The WhatsApp prompt is live in production. This is the exact text it had before the preamble became
 * channel-aware — the refactor must not change a single character of it, or every agency's prompt cache
 * and tuned behaviour shifts silently.
 */
const ORIGINAL_WHATSAPP_PREAMBLE = `You are Manasik Copilot, working as the WhatsApp assistant for a Hajj & Umrah travel agency. Customers see you under whatever display name the agency has configured below; staff see your work attributed to Manasik Copilot internally. You talk directly with pilgrims and prospective customers over WhatsApp.

Ground rules, in order of importance:
1. Never state a price, a seat count, a date, or a booking status that did not come from a tool result earlier in this conversation. If you don't have it, say you'll check, and call the tool that gets it.
2. You may create or update a lead and leave internal notes. You may never confirm a booking, record a payment, cancel anything, or quote a price you invented.
3. When in doubt — a request about money, a complaint, anything you're not confident handling correctly — hand off to a staff member rather than guessing.
4. Keep replies short. This is a chat conversation on a phone, not an email.
5. If asked something outside what your tools can answer (agency policy, cancellation terms, visa requirements), search the knowledge base if you have it; otherwise say you'll have a colleague follow up.
6. Voice messages are not transcribed. If a message says that you cannot listen to voice notes, politely ask the customer to type their question instead.
7. Work quickly. When you need several things that don't depend on each other (for example a lead update and a note), request all of those tools in the same step instead of one after another.`;

describe("renderFrozenPreamble", () => {
  it("is byte-for-byte the original text on WhatsApp", () => {
    expect(renderFrozenPreamble(getChannelProfile("WHATSAPP"))).toBe(ORIGINAL_WHATSAPP_PREAMBLE);
  });

  it("names the channel it is talking on", () => {
    const instagram = renderFrozenPreamble(getChannelProfile("INSTAGRAM"));
    expect(instagram).toContain("the Instagram assistant");
    expect(instagram).toContain("over Instagram.");
    // The word can appear (the phone-number rule asks for "a phone or WhatsApp number"), but the assistant is never called WhatsApp's.
    expect(instagram).not.toContain("the WhatsApp assistant");
    expect(instagram).not.toContain("over WhatsApp");
  });

  it("adds the automation-disclosure rule only where Meta's policy requires it", () => {
    expect(renderFrozenPreamble(getChannelProfile("WHATSAPP"))).not.toContain("automated assistant");
    expect(renderFrozenPreamble(getChannelProfile("MESSENGER"))).toContain("automated assistant");
    expect(renderFrozenPreamble(getChannelProfile("INSTAGRAM"))).toContain("automated assistant");
  });

  it("numbers the channel rules after the shared ones: disclosure is 8, the phone-number rule 9", () => {
    for (const provider of ["MESSENGER", "INSTAGRAM"] as const) {
      const text = renderFrozenPreamble(getChannelProfile(provider));
      expect(text).toContain("\n8. On ");
      expect(text.indexOf("automated assistant")).toBeLessThan(text.indexOf("9. On "));
      expect(text).toContain("capture_contact_number");
    }
  });

  it("asks for a phone number only where the channel does not already provide one", () => {
    expect(renderFrozenPreamble(getChannelProfile("WHATSAPP"))).not.toContain("capture_contact_number");
    expect(renderFrozenPreamble(getChannelProfile("MESSENGER"))).toContain("Never ask in your first reply");
  });

  it("forbids revealing what a typed number matches", () => {
    expect(renderFrozenPreamble(getChannelProfile("INSTAGRAM"))).toContain("never tell the customer anything about other records that number may match");
  });

  it("keeps every shared ground rule on every channel", () => {
    for (const provider of ["WHATSAPP", "MESSENGER", "INSTAGRAM"] as const) {
      const text = renderFrozenPreamble(getChannelProfile(provider));
      for (const rule of ["1. Never state a price", "2. You may create or update a lead", "3. When in doubt", "6. Voice messages are not transcribed", "7. Work quickly"]) {
        expect(text).toContain(rule);
      }
    }
  });
});
