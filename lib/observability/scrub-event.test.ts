import { describe, expect, it } from "vitest";

import { buildSentryOptions, resolveTracesSampleRate, sampleTrace } from "./sentry-options";
import { REDACTED, scrubSentryBreadcrumb, scrubSentryEvent, scrubString } from "./scrub-event";

const SAMPLE_CUSTOMER_TEXT = "Assalamu alaikum, my passport number N1234567 and card 4111 1111 1111 1111, call me";
const SAMPLE_PHONE_FORMS = ["+94 77 123 4567", "0771234567", "+94-77-123-4567", "(077) 123 4567", "94771234567"];
const SAMPLE_EMAIL = "mohamed.afras@example.com";
const AGENCY_ID = "3f0c5a52-8f3e-4c8e-9d8a-0b6a1f6a2c11";
const CONVERSATION_ID = "9b1d4e0a-2c7f-4f3b-8a55-6d2e1c0b9f77";

describe("scrubString", () => {
  it.each(SAMPLE_PHONE_FORMS)("removes the phone number %s", (phone) => {
    const out = scrubString(`failed to message ${phone} on WhatsApp`);
    expect(out).not.toContain(phone.replace(/\D/g, "").slice(-7));
    expect(out).toContain(REDACTED);
  });

  it("removes e-mail addresses, bearer tokens and JWTs", () => {
    const out = scrubString(`from ${SAMPLE_EMAIL} Bearer abcdefghijklmnop jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.c2lnbmF0dXJl`);
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain("eyJhbGci");
  });

  it("removes long digit runs such as card and account numbers", () => {
    expect(scrubString("card 4111 1111 1111 1111")).not.toMatch(/4111/);
    expect(scrubString("account 1234567890")).not.toMatch(/1234567890/);
  });

  it("keeps UUIDs intact, because they are the opaque ids used for debugging", () => {
    expect(scrubString(`conversation ${CONVERSATION_ID} failed`)).toContain(CONVERSATION_ID);
  });

  it("keeps ordinary short numbers and words", () => {
    expect(scrubString("retry 3 of 5 after 250ms")).toBe("retry 3 of 5 after 250ms");
  });
});

describe("scrubSentryEvent", () => {
  const event = {
    message: `Could not send to ${SAMPLE_EMAIL}`,
    exception: { values: [{ type: "Error", value: "insert failed for +94 77 123 4567: Key (display_name)=(Mohamed Afras) already exists" }] },
    request: {
      url: "https://crm.example.com/inbox?conversation=abc&q=0771234567",
      method: "POST",
      data: { body: SAMPLE_CUSTOMER_TEXT },
      headers: { cookie: "sb-access-token=secret", authorization: "Bearer abcdefghijklmnop" },
      cookies: { session: "secret" },
      query_string: "q=0771234567",
    },
    user: { id: "staff-1", email: SAMPLE_EMAIL, ip_address: "10.0.0.1" },
    extra: { body: SAMPLE_CUSTOMER_TEXT, customerName: "Mohamed", agency_id: AGENCY_ID, conversation_id: CONVERSATION_ID, nested: { caption: "hello", note: `see ${SAMPLE_EMAIL}` } },
    tags: { inbox_context: "sendStaffMessage.enqueue", phone: "0771234567" },
    breadcrumbs: [
      { category: "console", message: SAMPLE_CUSTOMER_TEXT },
      { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/messages?body=eq.hello&phone=0771234567", method: "GET" } },
      { category: "navigation", data: { from: "/inbox?conversation=1", to: "/inbox?q=0771234567" } },
    ],
  };

  const out = scrubSentryEvent(event);
  const serialised = JSON.stringify(out);

  it("leaves no message text, phone number, e-mail address, card or token anywhere in the event", () => {
    for (const forbidden of [SAMPLE_EMAIL, "mohamed.afras", "0771234567", "123 4567", "4111", "1234567", "Assalamu", "abcdefghijklmnop", "secret", "Mohamed", "10.0.0.1"]) {
      expect(serialised, `leaked: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("drops the request body, headers, cookies and query string, keeping only method and path", () => {
    expect(out.request).toEqual({ url: "https://crm.example.com/inbox", method: "POST" });
  });

  it("drops the user and the console breadcrumbs", () => {
    expect(out.user).toBeUndefined();
    expect(out.breadcrumbs).toHaveLength(2);
  });

  it("keeps the agency id, conversation id and context tag that make the report debuggable", () => {
    expect(serialised).toContain(AGENCY_ID);
    expect(serialised).toContain(CONVERSATION_ID);
    expect(out.tags).toMatchObject({ inbox_context: "sendStaffMessage.enqueue" });
  });

  it("does not change the original event", () => {
    expect(event.extra.body).toBe(SAMPLE_CUSTOMER_TEXT);
    expect(event.user.email).toBe(SAMPLE_EMAIL);
  });

  it("keeps the exception type and the non-personal part of the message", () => {
    expect(out.exception?.values?.[0]).toMatchObject({ type: "Error" });
    expect(String(out.exception?.values?.[0]?.value)).toContain("insert failed for");
  });
});

describe("scrubSentryBreadcrumb", () => {
  it("returns null for console output", () => {
    expect(scrubSentryBreadcrumb({ category: "console", message: "hi" })).toBeNull();
  });
});

describe("Sentry options", () => {
  it("is off without a DSN and never sends default PII", () => {
    const options = buildSentryOptions({ dsn: "", environment: undefined, tracesSampleRate: undefined });
    expect(options.dsn).toBeUndefined();
    expect(options.sendDefaultPii).toBe(false);
    expect(options.environment).toBe("development");
  });

  it("tags the environment it is given", () => {
    expect(buildSentryOptions({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "production", tracesSampleRate: undefined }).environment).toBe("production");
  });

  it("falls back to 10% for a missing or invalid trace rate and accepts a valid one", () => {
    expect(resolveTracesSampleRate(undefined)).toBe(0.1);
    expect(resolveTracesSampleRate("")).toBe(0.1);
    expect(resolveTracesSampleRate("banana")).toBe(0.1);
    expect(resolveTracesSampleRate("2")).toBe(0.1);
    expect(resolveTracesSampleRate("0.25")).toBe(0.25);
    expect(resolveTracesSampleRate("0")).toBe(0);
  });

  it("never traces cron, webhook, tunnel or static requests", () => {
    for (const name of ["GET /api/cron/inbox-lanes", "POST /api/webhooks/whatsapp", "POST /monitoring", "GET /_next/static/x.js"]) {
      expect(sampleTrace({ name }, 1), name).toBe(0);
    }
    expect(sampleTrace({ name: "GET /x", attributes: { "url.path": "/api/cron/inbox-sla" } }, 1)).toBe(0);
  });

  it("samples ordinary requests at the rate and follows the parent's decision", () => {
    expect(sampleTrace({ name: "GET /inbox" }, 0.1)).toBe(0.1);
    expect(sampleTrace({ name: "GET /inbox", parentSampled: true }, 0.1)).toBe(1);
    expect(sampleTrace({ name: "GET /inbox", parentSampled: false }, 0.1)).toBe(0);
  });
});
