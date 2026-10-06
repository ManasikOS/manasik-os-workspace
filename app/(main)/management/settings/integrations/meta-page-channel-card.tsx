"use client";

/**
 * Messenger and Instagram connect status, side by side with the WhatsApp card and using its status vocabulary.
 * Each channel has its OWN onboarding. Messenger signs in through /api/oauth/messenger/start: the agency shares a
 * Page. Instagram signs in through /api/oauth/instagram-login/start with Instagram itself — no Facebook Page is
 * needed — and the older route through a Page (/api/oauth/instagram/start) stays as a secondary link. Either way
 * the agency comes back connected, with no tokens, apps or webhook URLs on their side. See
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md §6.1 and
 * docs/tasks/TASK-006-instagram-login-connection.md.
 *
 * The assistant switch is deliberately here and off by default: Meta requires an automated assistant to say
 * so and to answer quickly, so the agency opts in knowingly. Everything else about the assistant — persona,
 * tone, knowledge, tools — is the ONE set of settings under AI Agent, shared by every channel.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TONE_TEXT } from "@/lib/ui/tone";

import { chooseInstagramAccount, getInstagramChoices } from "./instagram-actions";
import {
  chooseMessengerPage,
  disconnectInstagram,
  disconnectMessenger,
  getMessengerChoices,
  setInstagramAssistantEnabled,
  setMessengerAssistantEnabled,
  testInstagramConnection,
  testMessengerConnection,
} from "./messenger-actions";

export interface MetaPageChannelCardProps {
  channel: "MESSENGER" | "INSTAGRAM";
  status: "NOT_CONNECTED" | "PENDING" | "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "ERROR" | "RESTRICTED";
  /** The Page name (Messenger) or the @username (Instagram). */
  accountName: string | null;
  assistantEnabled: boolean;
  lastError: string | null;
  lastInboundAt: string | null;
  /** Whether the deployment has what this channel's Connect needs (Messenger: META_APP_ID + its configuration id; Instagram: INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET); without them Connect explains rather than fails. */
  configured: boolean;
  /** Instagram only: whether the older connection through a Facebook Page is set up too (META_APP_ID + META_INSTAGRAM_CONFIG_ID). Shows the secondary link. */
  fallbackConfigured?: boolean;
  canEdit: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  NOT_CONNECTED: "Not Connected",
  PENDING: "Pending",
  CONNECTED: "Connected",
  DEGRADED: "Needs Attention",
  DISCONNECTED: "Not Connected",
  ERROR: "Needs Reconnect",
  RESTRICTED: "Restricted",
};

const COPY = {
  MESSENGER: {
    title: "Messenger",
    intro: "Connect your agency's Facebook Page to receive Messenger messages directly inside your CRM.",
    waiting: "None yet — send a message to your Page to confirm",
    switchTitle: "Let the assistant reply on Messenger",
    restricted: "Meta has restricted this Page. Check the Page's status in Meta Business Suite.",
    attention: "Messenger needs attention. Test the connection or reconnect the Page.",
    connectLabel: "Connect with Facebook",
    connectPath: "/api/oauth/messenger/start",
    configName: "META_MESSENGER_CONFIG_ID",
    choiceTitle: "Which Facebook Page should this CRM use?",
    choiceAction: "Connect this Page",
  },
  INSTAGRAM: {
    title: "Instagram",
    intro: "Connect your agency's Instagram Business or Creator account to receive Instagram messages directly inside your CRM. You sign in with Instagram; no Facebook Page is needed.",
    waiting: "None yet — send a message to your Instagram account to confirm",
    switchTitle: "Let the assistant reply on Instagram",
    restricted: "Meta has restricted this Instagram account. Check its status in Meta Business Suite.",
    attention: "Instagram needs attention. Test the connection or reconnect the account.",
    connectLabel: "Connect with Instagram",
    connectPath: "/api/oauth/instagram-login/start",
    configName: "INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET",
    choiceTitle: "Which Instagram account should this CRM use?",
    choiceAction: "Connect this account",
  },
} as const;

/** The older Instagram connection, through the Facebook Page the account is linked to. */
const INSTAGRAM_PAGE_CONNECT = { label: "Connect through a Facebook Page instead", path: "/api/oauth/instagram/start" } as const;

export function MetaPageChannelCard({ channel, status, accountName, assistantEnabled, lastError, lastInboundAt, configured, fallbackConfigured = false, canEdit }: MetaPageChannelCardProps) {
  const copy = COPY[channel];
  const isMessenger = channel === "MESSENGER";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assistantOn, setAssistantOn] = useState(assistantEnabled);
  const router = useRouter();

  const isConnected = status === "CONNECTED" || status === "DEGRADED" || status === "ERROR" || status === "RESTRICTED";
  const isProblem = status === "ERROR" || status === "DEGRADED" || status === "RESTRICTED";

  // The redirect flow returns here with ?messenger|instagram=connected|error|choose&message=… (see app/api/oauth/<channel>/callback).
  const searchParams = useSearchParams();
  const returnParam = searchParams.get(isMessenger ? "messenger" : "instagram");
  const returnedMessage = returnParam ? searchParams.get("message") : null;
  const needsChoice = returnParam === "choose";
  const [choices, setChoices] = useState<Array<{ id: string; label: string }> | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => {
    if (!needsChoice) return;
    let cancelled = false;
    const load = isMessenger
      ? getMessengerChoices().then((found) => found.map((page) => ({ id: page.pageId, label: page.pageName ?? `Page ${page.pageId}` })))
      : getInstagramChoices().then((found) => found.map((account) => ({ id: account.instagramAccountId, label: account.pageName ? `${account.label} (Page: ${account.pageName})` : account.label })));
    void load.then((found) => {
      if (!cancelled) setChoices(found);
    });
    return () => {
      cancelled = true;
    };
  }, [needsChoice, isMessenger]);

  async function handleChoose() {
    if (!pickedId) return;
    setBusy(true);
    const result = isMessenger
      ? await chooseMessengerPage({ pageId: pickedId }).then((r) => (r.ok ? { ok: true as const, label: r.pageName } : r))
      : await chooseInstagramAccount({ instagramAccountId: pickedId }).then((r) => (r.ok ? { ok: true as const, label: r.accountLabel } : r));
    setMessage(result.ok ? `Connected: ${result.label}` : result.error);
    setBusy(false);
    if (result.ok) {
      setChoices(null);
      router.replace("/management/settings/integrations");
      router.refresh();
    }
  }

  function handleConnect() {
    if (!configured) {
      setMessage(`${copy.title} connect is not configured for this deployment (${copy.configName} is missing from the environment).`);
      return;
    }
    setBusy(true);
    window.location.assign(copy.connectPath);
  }

  function handleConnectThroughPage() {
    setBusy(true);
    window.location.assign(INSTAGRAM_PAGE_CONNECT.path);
  }

  async function handleDisconnect() {
    setBusy(true);
    const result = await (isMessenger ? disconnectMessenger() : disconnectInstagram());
    setMessage(result.ok ? "Disconnected. Your conversations are kept." : result.error);
    setBusy(false);
    if (result.ok) router.refresh();
  }

  async function handleTest() {
    setBusy(true);
    const result = await (isMessenger ? testMessengerConnection() : testInstagramConnection());
    setMessage(result.ok ? `Connection OK: ${result.pageName}` : result.error);
    setBusy(false);
    router.refresh();
  }

  async function handleAssistantToggle(next: boolean) {
    setAssistantOn(next); // optimistic; reverted if the server refuses
    const result = await (isMessenger ? setMessengerAssistantEnabled(next) : setInstagramAssistantEnabled(next));
    if (!result.ok) {
      setAssistantOn(!next);
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">{isConnected && accountName ? accountName : copy.intro}</p>
        </div>
        <Badge variant={status === "CONNECTED" ? "default" : isProblem ? "destructive" : "outline"}>{STATUS_LABEL[status] ?? status}</Badge>
      </div>

      {status === "ERROR" && <p className="text-xs text-destructive">{lastError || "The connection needs to be reconnected."}</p>}
      {status === "DEGRADED" && <p className={`text-xs ${TONE_TEXT.warning}`}>{lastError || copy.attention}</p>}
      {status === "RESTRICTED" && <p className="text-xs text-destructive">{copy.restricted}</p>}

      {isConnected && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <dt>Last message received</dt>
            <dd>{lastInboundAt ? new Date(lastInboundAt).toLocaleString() : copy.waiting}</dd>
          </dl>

          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{copy.switchTitle}</p>
              <p className="text-xs text-muted-foreground">
                Off by default. When on, the assistant tells customers it is an automated assistant and a person can take over. Its persona, tone and knowledge
                are the same on every channel — change them under{" "}
                <Link href="/management/ai-agent" className="underline underline-offset-2">
                  AI Agent
                </Link>
                . When off, messages still arrive here for your team to answer.
              </p>
            </div>
            <Switch checked={assistantOn} onCheckedChange={handleAssistantToggle} disabled={!canEdit || busy} aria-label={copy.switchTitle} />
          </div>
        </>
      )}

      {(message ?? returnedMessage) && <p className="text-xs text-muted-foreground">{message ?? returnedMessage}</p>}

      {needsChoice && choices && choices.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-xs font-medium">{copy.choiceTitle}</legend>
          {choices.map((choice) => (
            <Button
              key={choice.id}
              type="button"
              variant="outline"
              aria-pressed={pickedId === choice.id}
              onClick={() => setPickedId(choice.id)}
              className="h-auto w-full justify-start whitespace-normal py-2 text-left"
            >
              <Check className={pickedId === choice.id ? "size-4 opacity-100" : "size-4 opacity-0"} />
              <span>{choice.label}</span>
            </Button>
          ))}
          <div>
            <Button size="sm" disabled={busy || !pickedId} onClick={handleChoose}>
              {copy.choiceAction}
            </Button>
          </div>
        </fieldset>
      )}
      {needsChoice && choices && choices.length === 0 && <p className="text-xs text-muted-foreground">This choice has expired. Click {copy.connectLabel} to start again.</p>}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={handleTest}>
                Test Connection
              </Button>
              {isProblem && (
                <Button size="sm" disabled={busy} onClick={handleConnect}>
                  Reconnect
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={handleDisconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={handleConnect}>
                {copy.connectLabel}
              </Button>
              {channel === "INSTAGRAM" && fallbackConfigured && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={handleConnectThroughPage}>
                  {INSTAGRAM_PAGE_CONNECT.label}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
