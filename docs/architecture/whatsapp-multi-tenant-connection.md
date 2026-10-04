# WhatsApp connection for many agencies (multi-tenant)

Decided 2026-09-19 after reading Meta's Embedded Signup documentation and inspecting the live Meta app.
Supersedes the "Mode A / own Meta app" path in
[whatsapp-meta-connection-implementation-plan.md](../modules/whatsapp-meta-connection-implementation-plan.md), which was removed.

## The rule
**One Meta app (ours), one connect flow (Embedded Signup), one webhook URL.** An agency never sees a token, an
app id, a webhook URL or a verify token. It signs in to Meta, chooses or creates its WhatsApp Business Account
and phone number, approves, and comes back connected.

## What Meta's documentation says (sources at the end)
- We are a **Tech Provider**. Customers own their WhatsApp Business Accounts (WABAs) and numbers; we get access
  through **business tokens** (Business Integration System User access tokens), each **scoped to one onboarded
  customer**. Tech Providers use business tokens exclusively.
- Embedded Signup returns an **exchangeable code with a 30 second lifetime**. It is exchanged server-side:
  `GET /oauth/access_token?client_id=<app id>&client_secret=<app secret>&code=<code>`. (When the code comes from
  a page redirect, Meta also needs the same `redirect_uri` that was used to obtain it.)
- The customer's asset ids (`waba_id`, `phone_number_id`, `business_id`) come from the popup's `WA_EMBEDDED_SIGNUP`
  message event, or, without the SDK, from `debug_token` on the exchanged token (`granular_scopes`), which is
  what we use.
- After the exchange: `POST /<version>/<WABA_ID>/subscribed_apps` with the business token, then register the
  number (`POST /<PHONE_NUMBER_ID>/register` with a 6-digit PIN) unless it is already registered.
- **`account_update` webhook** is the event that reports a completed signup. One app-level webhook serves every
  customer WABA.
- **Advanced access** to `whatsapp_business_management` and `whatsapp_business_messaging`, business
  verification and app review are required to onboard other businesses. Onboarding is limited to 10 customers
  per rolling 7 days until verified, then 200.
- **Billing:** Tech Provider customers add their own payment method in WhatsApp Manager before messages send.
- **Hosted Embedded Signup** (the `business.facebook.com/messaging/whatsapp/onboard/...` link) is Meta-hosted: it
  reports the result **only by the `account_update` webhook** (`PARTNER_ADDED`), with no code returned. We do not
  use it as the connect button for that reason. Its configuration also has no Assets step, so a token from it
  names no WABA.

## Our design
| Concern | Design |
|---|---|
| Connect button | Full-page redirect to `https://www.facebook.com/<version>/dialog/oauth` with `config_id`, `response_type=code`, `override_default_response_type=true`, `extras={setup:{},sessionInfoVersion:"3",version:"v4"}` (`lib/whatsapp/embedded-signup-redirect.ts`). No Facebook JS SDK, so no extension or CSP can leave the button dead. |
| Return | Meta redirects to the site root (already a registered redirect URI) with `?code&state=wa_…`; a `next.config.ts` redirect forwards it to `/api/oauth/whatsapp/callback`. State cookie prevents CSRF. |
| Token exchange | `connectWhatsApp()` on the server: exchange code, `debug_token` for the WABA, list numbers, `verifyConnection`, store the token in Vault per agency, subscribe the app to the WABA, register the number. |
| Tenant routing of inbound events | **One** unkeyed webhook `/api/webhooks/whatsapp`, signature checked with our `META_APP_SECRET`, tenant resolved from `phone_number_id` in the payload (`resolveAgencyForPhoneNumberId`). Unknown numbers are recorded and dropped, never guessed. |
| Isolation | Token per agency in Vault, every query scoped by `agency_id`, one WABA per agency. |
| Removed | "Connect your own Meta app" wizard, `connectWhatsAppOwnApp`, `getWebhookInstructions`, the per-agency keyed webhook route, `WHATSAPP_CONNECT_MODE`. |

## Required Meta app settings (one time, ours)
1. **App-level webhook** (WhatsApp Business Account object): callback `https://<production domain>/api/webhooks/whatsapp`,
   verify token = `WHATSAPP_VERIFY_TOKEN`, fields `messages`, `account_update` and the template/quality fields.
   **It must not be a per-agency keyed URL.** The app pointed at a keyed URL from the old own-app setup, and that route
   only accepted own-app integrations, so messages to an Embedded Signup number were dropped.
2. **Facebook Login for Business** → valid OAuth redirect URIs include `https://<domain>/` for every domain; JavaScript SDK
   settings are no longer needed.
3. **Embedded Signup configuration** (`META_CONFIG_ID`): login variation "WhatsApp Embedded Signup", with the WhatsApp
   Business Account assets. Choose a **non-expiring** business token where offered; a 60-day token needs the re-auth flow.
4. **App Review**: Advanced access to both WhatsApp permissions; business verification; app in Live mode.
5. **Basic settings**: App domains, https Site URL, privacy / terms / data-deletion URLs.

## Sources
- [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Hosted Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es/)
- [Access tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
