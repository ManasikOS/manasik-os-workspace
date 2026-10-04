/**
 * The guided setup's step definitions and progress rules (docs/onboarding/plan.md §5, §7.2).
 *
 * Pure on purpose. "Done" is derived from live data (`SetupFacts`) plus the few
 * facts the database cannot infer (`SetupStateRow`: skips, "you confirmed your
 * basics", "you set a password"), so the guide can never drift from reality.
 */

export const SETUP_STEP_IDS = ["account", "agency", "team", "channels", "payments", "package"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStepStatus = "DONE" | "SKIPPED" | "NOT_STARTED";

export interface SetupStepDefinition {
  id: SetupStepId;
  title: string;
  /** What the owner gets from doing it. */
  benefit: string;
  /** What they lose by waiting — shown on the step's "Do this later" button. */
  waitingCost: string;
  /** Existing screen that does the real work until the guided version of the step ships. */
  href: string;
  hrefLabel: string | null;
}

export const SETUP_STEPS: readonly SetupStepDefinition[] = [
  {
    id: "account",
    title: "Secure your account",
    benefit: "Sign in with a password as well as an email link.",
    waitingCost: "You can keep signing in with a secure email link.",
    href: "/login?mode=reset",
    hrefLabel: null,
  },
  {
    id: "agency",
    title: "Your agency",
    benefit: "Set your country, currency, timezone, language and logo so prices, dates and documents look right.",
    waitingCost: "Until you do, dates and prices may not match your country.",
    href: "/management/settings/organisation",
    hrefLabel: "Open agency settings",
  },
  {
    id: "team",
    title: "Invite your team",
    benefit: "Give your staff their own sign-in, with access matched to their job.",
    waitingCost: "Until you do, you are the only person who can use the workspace.",
    href: "/management/team",
    hrefLabel: "Open your team",
  },
  {
    id: "channels",
    title: "Connect your channels",
    benefit: "Receive and reply to pilgrim messages in one inbox.",
    waitingCost: "Until a channel is connected, messages won't appear in your inbox.",
    href: "/management/settings/integrations",
    hrefLabel: "Open integrations",
  },
  {
    id: "payments",
    title: "Get paid",
    benefit: "Add the bank accounts pilgrims pay into, so payments can be matched.",
    waitingCost: "Until you do, payments can't be matched to a bank account.",
    href: "/management/settings/finance",
    hrefLabel: "Open finance settings",
  },
  {
    id: "package",
    title: "Add your first package",
    benefit: "Create a Hajj or Umrah package you can start selling.",
    waitingCost: "Until you do, there is nothing to sell or quote.",
    href: "/packages",
    hrefLabel: "Open packages",
  },
];

/** Live facts read from the agency's own tables. */
export interface SetupFacts {
  activeStaffCount: number;
  /** True when at least one messaging channel (WhatsApp or email) is CONNECTED. */
  channelConnected: boolean;
  paymentAccountCount: number;
  packageCount: number;
}

/** What `agency_onboarding_state` holds — only what cannot be derived. */
export interface SetupStateRow {
  steps: Record<string, string>;
  basicsConfirmedAt: string | null;
  passwordSetAt: string | null;
  guideDismissedAt: string | null;
  lastStep: string | null;
}

export interface SetupStepProgress extends SetupStepDefinition {
  status: SetupStepStatus;
}

export interface SetupProgress {
  steps: SetupStepProgress[];
  doneCount: number;
  total: number;
  /** First step not started, else the first skipped one, else null when everything is done. */
  nextOpenStepId: SetupStepId | null;
  allDone: boolean;
  guideDismissed: boolean;
}

function isDone(id: SetupStepId, facts: SetupFacts, state: SetupStateRow): boolean {
  switch (id) {
    case "account":
      return state.passwordSetAt !== null;
    case "agency":
      return state.basicsConfirmedAt !== null;
    case "team":
      return facts.activeStaffCount > 1;
    case "channels":
      return facts.channelConnected;
    case "payments":
      return facts.paymentAccountCount > 0;
    case "package":
      return facts.packageCount > 0;
  }
}

export function deriveSetupProgress(facts: SetupFacts, state: SetupStateRow): SetupProgress {
  const steps = SETUP_STEPS.map((definition): SetupStepProgress => {
    const status: SetupStepStatus = isDone(definition.id, facts, state)
      ? "DONE"
      : state.steps[definition.id] === "SKIPPED"
        ? "SKIPPED"
        : "NOT_STARTED";
    return { ...definition, status };
  });

  const doneCount = steps.filter((step) => step.status === "DONE").length;
  const nextOpen =
    steps.find((step) => step.status === "NOT_STARTED") ?? steps.find((step) => step.status === "SKIPPED") ?? null;

  return {
    steps,
    doneCount,
    total: steps.length,
    nextOpenStepId: nextOpen?.id ?? null,
    allDone: doneCount === steps.length,
    guideDismissed: state.guideDismissedAt !== null,
  };
}

/** Returns a copy of the stored steps with `stepId` marked skipped. */
export function withSetupStepSkipped(steps: Record<string, string>, stepId: SetupStepId): Record<string, string> {
  return { ...steps, [stepId]: "SKIPPED" };
}
