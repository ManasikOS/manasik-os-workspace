/**
 * Renders a `BrochureViewModel` (see `brochure-view-model.ts`) to a PDF
 * buffer with `@react-pdf/renderer` — the first PDF-generation code in this
 * repo (TASK-023). No business logic lives here: this only lays out what
 * `buildBrochureViewModel` already decided.
 */

import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { BrochureViewModel } from "@/lib/content/brochure-view-model";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 4 },
  code: { fontSize: 10, color: "#555555", marginBottom: 12 },
  sectionTitle: { fontSize: 13, marginTop: 16, marginBottom: 6, borderBottom: "1pt solid #cccccc", paddingBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  itineraryRow: { marginBottom: 6 },
  itineraryDay: { fontSize: 10, fontWeight: 700 },
  listItem: { marginBottom: 2 },
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

export function BrochureDocument({ model }: { model: BrochureViewModel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{model.groupName}</Text>
        <Text style={styles.code}>
          {model.groupCode} · {formatDate(model.departureDate)} – {formatDate(model.returnDate)} · {model.durationLabel}
        </Text>
        <Text>{model.overview}</Text>

        <Text style={styles.sectionTitle}>Pricing (per person)</Text>
        {model.occupancyPrices.map((price) => (
          <View key={price.label} style={styles.row}>
            <Text>{price.label}</Text>
            <Text>{formatMoney(model.currency, price.amount)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Itinerary</Text>
        {model.itinerary.map((item) => (
          <View key={item.dayNumber} style={styles.itineraryRow}>
            <Text style={styles.itineraryDay}>Day {item.dayNumber} — {item.title}</Text>
            <Text>{item.location}</Text>
            <Text>{item.description}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Accommodation</Text>
        {model.accommodations.map((accommodation) => (
          <View key={accommodation.city} style={styles.itineraryRow}>
            <Text style={styles.itineraryDay}>{accommodation.city} — {accommodation.customer_wording}</Text>
            <Text>{accommodation.nights} nights · {accommodation.meal_plan} · {accommodation.target_distance} from Haram</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Inclusions</Text>
        {model.inclusions.map((item) => (
          <Text key={item} style={styles.listItem}>• {item}</Text>
        ))}

        <Text style={styles.sectionTitle}>Exclusions</Text>
        {model.exclusions.map((item) => (
          <Text key={item} style={styles.listItem}>• {item}</Text>
        ))}

        <Text style={styles.sectionTitle}>Terms</Text>
        <Text style={styles.listItem}>Payment: {model.policy.paymentTerms}</Text>
        <Text style={styles.listItem}>Cancellation: {model.policy.cancellationPolicy}</Text>
        <Text style={styles.listItem}>Late payment: {model.policy.latePaymentPolicy}</Text>
        <Text style={styles.listItem}>{model.policy.priceChangeDisclaimer}</Text>
      </Page>
    </Document>
  );
}

export async function renderBrochurePdf(model: BrochureViewModel): Promise<Buffer> {
  return renderToBuffer(<BrochureDocument model={model} />);
}
