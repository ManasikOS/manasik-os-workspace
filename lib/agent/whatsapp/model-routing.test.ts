import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canRetryOnPaidModel, freeChatModel, shouldUseFreeChatModel } from "@/lib/agent/whatsapp/model-routing";

const customer = { role: "user", actor_kind: "CUSTOMER" } as const;
const assistant = { role: "assistant", actor_kind: "AI" } as const;
const staff = { role: "staff", actor_kind: "STAFF" } as const;

afterEach(() => vi.unstubAllEnvs());

describe("shouldUseFreeChatModel", () => {
  it("never uses the free model unless one is explicitly configured", () => {
    expect(shouldUseFreeChatModel({ state: "AI_ACTIVE" }, [customer, assistant, customer])).toBe(false);
    vi.stubEnv("AI_FREE_CHAT_MODEL", "");
    expect(shouldUseFreeChatModel({ state: "AI_ACTIVE" }, [customer])).toBe(false);
  });

  it("uses the free model while only the customer and the assistant have spoken, once one is configured", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "qwen/qwen3.8-27b:free");
    expect(shouldUseFreeChatModel({ state: "AI_ACTIVE" }, [customer, assistant, customer])).toBe(true);
  });

  it("uses the paid model once staff have written in the conversation", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "qwen/qwen3.8-27b:free");
    expect(shouldUseFreeChatModel({ state: "AI_ACTIVE" }, [customer, staff, customer])).toBe(false);
  });

  it("uses the paid model after staff hand the chat back to the assistant", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "qwen/qwen3.8-27b:free");
    expect(shouldUseFreeChatModel({ state: "AI_RESUMED" }, [customer, assistant])).toBe(false);
  });

  it("uses the paid model when the customer asked for a person", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "qwen/qwen3.8-27b:free");
    expect(shouldUseFreeChatModel({ state: "HUMAN_REQUESTED" }, [customer])).toBe(false);
  });

  it("can be switched off with AI_FREE_CHAT_MODEL=off", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "off");
    expect(shouldUseFreeChatModel({ state: "AI_ACTIVE" }, [customer])).toBe(false);
  });
});

describe("freeChatModel", () => {
  it("is null by default: the free model is opt-in", () => {
    expect(freeChatModel()).toBeNull();
    vi.stubEnv("AI_FREE_CHAT_MODEL", "   ");
    expect(freeChatModel()).toBeNull();
  });

  it("treats \"off\" in any case as not configured", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "OFF");
    expect(freeChatModel()).toBeNull();
  });

  it("returns the slug that was configured", () => {
    vi.stubEnv("AI_FREE_CHAT_MODEL", "qwen/qwen3.8-27b:free");
    expect(freeChatModel()).toBe("qwen/qwen3.8-27b:free");
  });
});

describe("canRetryOnPaidModel", () => {
  it("allows a retry when nothing ran or only read-only tools ran", () => {
    expect(canRetryOnPaidModel([])).toBe(true);
    expect(canRetryOnPaidModel([{ toolName: "search_departures" }, { toolName: "search_knowledge_base" }])).toBe(true);
  });

  it("refuses a retry once a write tool ran, so a lead or booking is not created twice", () => {
    expect(canRetryOnPaidModel([{ toolName: "search_departures" }, { toolName: "find_or_create_lead" }])).toBe(false);
    expect(canRetryOnPaidModel([{ toolName: "confirm_and_hold_booking" }])).toBe(false);
  });
});
