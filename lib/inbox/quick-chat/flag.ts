/**
 * Whether the Quick Chat popup is turned on for this deployment. Set `QUICK_CHAT_ENABLED=1` on the web deployment.
 *
 * Off by default. Off means the popup never renders and every "Send by WhatsApp" button keeps opening `wa.me` exactly as it does
 * today, so the feature can be rolled out and rolled back without touching the pages that call it.
 */
export function isQuickChatEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.QUICK_CHAT_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
