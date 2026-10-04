/**
 * What OpenRouter may do with the prompts we send it. Customer messages carry names, phone numbers and passport
 * questions, so the deployment can require that they only reach providers that do not keep or train on them.
 *
 * `OPENROUTER_DATA_POLICY` (unset by default, so nothing changes until it is set):
 *   - `deny` — route only to providers that do not collect user data (`provider.data_collection: "deny"`).
 *   - `zdr`  — also require zero-data-retention endpoints (`provider.zdr: true`).
 *
 * The setting restricts which providers may serve a request, so a model with no qualifying provider fails instead of
 * silently falling back. Turn it on in staging, confirm every AI surface still answers, then enable it in production.
 * OpenRouter documents `provider` on the chat-completions endpoint; whether the Anthropic-compatible endpoint the
 * assistant uses honours it must be confirmed the same way. The account-level privacy settings on OpenRouter are the
 * backstop either way.
 */

export type OpenRouterProviderPreferences = { provider: { data_collection: "deny"; zdr?: true } };

/** The `provider` request field for the configured policy, or nothing when no policy is set. */
export function openRouterProviderPreferences(): OpenRouterProviderPreferences | Record<string, never> {
  const policy = process.env.OPENROUTER_DATA_POLICY?.trim().toLowerCase();
  if (policy === "zdr") return { provider: { data_collection: "deny", zdr: true } };
  if (policy === "deny") return { provider: { data_collection: "deny" } };
  return {};
}

/**
 * A `fetch` that adds the provider preferences to a JSON request body. Given to the Anthropic SDK client so the
 * assistant's calls carry the same policy as the direct chat-completions calls. A body that is not JSON, or that
 * already names a `provider`, is left exactly as it was.
 */
export function fetchWithProviderPreferences(baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const preferences = openRouterProviderPreferences();
    if (!("provider" in preferences) || typeof init?.body !== "string") return baseFetch(input, init);
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (body === null || typeof body !== "object" || Array.isArray(body) || "provider" in body) return baseFetch(input, init);
      return baseFetch(input, { ...init, body: JSON.stringify({ ...body, ...preferences }) });
    } catch {
      return baseFetch(input, init);
    }
  };
}
