import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";

/**
 * How each autonomy level is described to an administrator. The level codes (L0–L3) and the internal modes behind them
 * stay in the code; what is shown says what the assistant will actually do, in words anyone can act on.
 */

export interface AutonomyLevelCopy {
  name: string;
  description: string;
}

export const AUTONOMY_LEVEL_COPY: Record<AutonomyLevel, AutonomyLevelCopy> = {
  L0: { name: "Observe only", description: "The system reads conversations but never sends a reply on its own." },
  L1: { name: "Draft replies", description: "The system prepares editable replies for staff to check and send." },
  L2: { name: "Safe automatic replies", description: "The system sends approved greetings, FAQ answers and qualifying questions." },
  L3: { name: "Lead intake assistant", description: "The system collects basic trip details, then hands the chat to staff." },
};

export function autonomyLevelName(level: AutonomyLevel): string {
  return AUTONOMY_LEVEL_COPY[level].name;
}
