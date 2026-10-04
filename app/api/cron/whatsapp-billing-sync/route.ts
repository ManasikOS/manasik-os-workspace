/**
 * WhatsApp billing sync — nightly. §5 E10 layer 1 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md.
 *
 * Per connected, funded integration:
 *   1. Pull `pricing_analytics` for a rolling window (Meta restates recent
 *      days, so a single-day sync silently under-reports) — 90 days on
 *      first sync so the Billing screen is useful on day one.
 *   2. Upsert `whatsapp_billing_daily` — Meta's own rollup, verbatim (D10).
 *   3. Derive `whatsapp_rate_observations` — cost ÷ volume per bucket per
 *      day (D11). Never a hardcoded rate card; this is what makes the
 *      1 July / 1 Aug / 1 Oct 2026 pricing changes (F13) self-updating.
 *   4. Price every unpriced `whatsapp_message_charges` row against the
 *      observation for its own bucket on its own day — left unpriced and
 *      retried tomorrow if no matching observation exists yet.
 *   5. Compare month-to-date spend against `whatsapp_billing_budgets` and
 *      raise a notification at each unpassed threshold.
 *
 * Legacy (pre-per-message-pricing) WABAs fall back to
 * `conversation_analytics` — out of scope for this pass; flagged in
 * §9 open question 1 territory, not attempted here. `pricing_analytics` is
 * what every current WABA reports (F12).
 */

import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { NextResponse, type NextRequest } from "next/server";

import { colomboDayKey } from "@/lib/date";
import { listActiveIntegrations, recordConnectionEvent } from "@/lib/data/whatsapp-connection-repository";
import {
  findRateObservation,
  getBillingBudget,
  listUnpricedCharges,
  markBudgetAlerted,
  monthToDateSpend,
  priceMessageCharge,
  upsertBillingDaily,
  upsertRateObservation,
} from "@/lib/data/whatsapp-billing-repository";
import { getPricingAnalytics } from "@/lib/whatsapp/client";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import { createAdminClient } from "@/utils/supabase/admin";

const CRON_SECRET = process.env.CRON_SECRET;
const ROLLING_WINDOW_DAYS = Number(process.env.WHATSAPP_BILLING_SYNC_WINDOW_DAYS ?? "7");
const BACKFILL_DAYS = 90;

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!hasValidBearerSecret(authHeader, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const integrations = await listActiveIntegrations(admin);

  let synced = 0;
  let priced = 0;
  let failed = 0;

  for (const integration of integrations) {
    if (!integration.credential_ref || !integration.business_account_id) continue;

    try {
      const { count } = await admin
        .from("whatsapp_billing_daily")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", integration.agency_id);
      const windowDays = count && count > 0 ? ROLLING_WINDOW_DAYS : BACKFILL_DAYS;

      const token = await readWhatsAppToken(admin, integration.credential_ref);
      if (!token) throw new Error("Vault returned no token for this credential_ref");

      const endUnix = Math.floor(Date.now() / 1000);
      const startUnix = endUnix - windowDays * 24 * 60 * 60;

      const buckets = await getPricingAnalytics(integration.business_account_id, token, {
        startUnix,
        endUnix,
        granularity: "DAILY",
        metricTypes: ["COST", "VOLUME"],
        dimensions: ["COUNTRY", "PHONE", "PRICING_CATEGORY", "PRICING_TYPE", "TIER"],
      });

      for (const bucket of buckets) {
        const day = colomboDayKey(new Date(bucket.start * 1000));
        const countryCode = bucket.country ?? "";
        const pricingCategory = bucket.pricingCategory ?? "";
        const pricingType = bucket.pricingType ?? "";
        const tier = bucket.tier ?? "";
        const currency = bucket.currency ?? "USD";

        await upsertBillingDaily(admin, {
          agencyId: integration.agency_id,
          day,
          phoneNumberId: bucket.phoneNumber ?? integration.phone_number_id ?? "",
          countryCode,
          pricingCategory,
          pricingType,
          tier,
          cost: bucket.cost,
          volume: bucket.volume,
          currency,
          source: "PRICING_ANALYTICS",
        });

        await upsertRateObservation(admin, {
          agencyId: integration.agency_id,
          observedOn: day,
          countryCode,
          pricingCategory,
          pricingType,
          tier,
          cost: bucket.cost,
          volume: bucket.volume,
          currency,
        });
      }

      // Price the attribution rows now that today's (and recent days')
      // rate observations exist.
      const unpriced = await listUnpricedCharges(admin, integration.agency_id);
      for (const charge of unpriced as Array<{
        id: string;
        recipient_country: string | null;
        pricing_category: string | null;
        pricing_type: string | null;
        charged_on: string | null;
      }>) {
        if (!charge.charged_on) continue;
        const observation = await findRateObservation(
          admin,
          integration.agency_id,
          {
            countryCode: charge.recipient_country ?? "",
            pricingCategory: charge.pricing_category ?? "",
            pricingType: charge.pricing_type ?? "",
            tier: "",
          },
          charge.charged_on,
        );
        if (!observation) continue;
        await priceMessageCharge(admin, charge.id, {
          estimatedCost: observation.unitRate,
          estimatedCurrency: observation.currency,
          rateObservationId: observation.id,
        });
        priced++;
      }

      // Budget alerting — layer 3. Never blocks anything here; that's the
      // send path's job (E9). This only raises the notification.
      const budget = await getBillingBudget(admin, integration.agency_id);
      if (budget?.monthly_budget) {
        const { cost } = await monthToDateSpend(admin, integration.agency_id);
        const percent = Math.floor((cost / budget.monthly_budget) * 100);
        const nextThreshold = budget.alert_at_percent
          .filter((t) => percent >= t && t > budget.last_alerted_percent)
          .sort((a, b) => b - a)[0];
        if (nextThreshold !== undefined) {
          await recordConnectionEvent(admin, {
            agencyId: integration.agency_id,
            integrationId: integration.id,
            kind: "BUDGET_THRESHOLD_REACHED",
            detail: { percent: nextThreshold, monthToDateCost: cost, monthlyBudget: budget.monthly_budget },
          });
          await markBudgetAlerted(admin, integration.agency_id, nextThreshold);
        }
      }

      synced++;
    } catch (error) {
      failed++;
      await recordConnectionEvent(admin, {
        agencyId: integration.agency_id,
        integrationId: integration.id,
        kind: "BILLING_SYNC_FAILED",
        detail: { error: error instanceof Error ? error.message : String(error) },
      }).catch(() => undefined);
    }
  }

  return NextResponse.json({ synced, priced, failed }, { status: 200 });
}
