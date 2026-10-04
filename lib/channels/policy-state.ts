export type ChannelPolicyAction = "FREE_FORM" | "APPROVED_TEMPLATE" | "HUMAN_AGENT" | "BLOCKED";

export interface ChannelPolicyInput {
  channel: string;
  now: Date;
  serviceWindowExpiresAt: string | null;
  humanAgentWindowExpiresAt: string | null;
  handlingMode: string | null;
  hasOpenSupportCase: boolean;
  author: "HUMAN" | "AUTOMATION";
  projectedTemplateCharge: number | null;
  chargeCurrency: string | null;
}

export interface ChannelPolicyState {
  action: ChannelPolicyAction;
  templateRequired: boolean;
  humanAgentTagEligible: boolean;
  projectedCharge: { amount: number; currency: string } | null;
  notice: string;
}

export function resolveChannelPolicyState(input: ChannelPolicyInput): ChannelPolicyState {
  const withinServiceWindow = input.serviceWindowExpiresAt !== null && new Date(input.serviceWindowExpiresAt).getTime() >= input.now.getTime();
  if (input.channel === "WHATSAPP") {
    if (withinServiceWindow) return { action: "FREE_FORM", templateRequired: false, humanAgentTagEligible: false, projectedCharge: null, notice: "Service window open — a free-form reply is allowed." };
    const projectedCharge = input.projectedTemplateCharge === null || !input.chargeCurrency ? null : { amount: input.projectedTemplateCharge, currency: input.chargeCurrency };
    return { action: "APPROVED_TEMPLATE", templateRequired: true, humanAgentTagEligible: false, projectedCharge, notice: "The service window is closed. Choose an approved template; its charge is shown before sending." };
  }
  if (input.channel === "MESSENGER" || input.channel === "INSTAGRAM") {
    if (withinServiceWindow) return { action: "FREE_FORM", templateRequired: false, humanAgentTagEligible: false, projectedCharge: null, notice: "The 24-hour reply window is open." };
    const withinHumanWindow = input.humanAgentWindowExpiresAt !== null && new Date(input.humanAgentWindowExpiresAt).getTime() >= input.now.getTime();
    const humanEligible = withinHumanWindow && input.handlingMode === "HUMAN_ACTIVE" && input.hasOpenSupportCase && input.author === "HUMAN";
    if (humanEligible) return { action: "HUMAN_AGENT", templateRequired: false, humanAgentTagEligible: true, projectedCharge: null, notice: "A human-written support reply is allowed under the HUMAN_AGENT tag." };
    return { action: "BLOCKED", templateRequired: false, humanAgentTagEligible: false, projectedCharge: null, notice: withinHumanWindow ? "Only a human-written reply on an active support case is allowed." : "The seven-day support window is closed. Re-engage elsewhere with consent or wait for the customer." };
  }
  return { action: "FREE_FORM", templateRequired: false, humanAgentTagEligible: false, projectedCharge: null, notice: "A reply is allowed." };
}
