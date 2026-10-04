import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // "Today" must be read in the agency's own timezone (Asia/Colombo),
      // not UTC — see lib/date.ts. This pattern silently shifts the day
      // boundary by up to 5.5 hours (docs/architecture/production-readiness-plan.md P1-4).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='slice'][arguments.0.value=0][arguments.1.value=10][callee.object.callee.property.name='toISOString'][callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0]",
          message:
            "Use colomboDayKey() from @/lib/date instead of toISOString().slice(0, 10) — that reads UTC, not the agency's Asia/Colombo timezone.",
        },
      ],
    },
  },
  {
    // A status (lead stage, booking state, payment health, …) must read the
    // same colour everywhere — that's the entire point of the shared tone
    // vocabulary in lib/ui/tone.ts (TONE_CLASS/TONE_BAR, consumed via
    // <ToneBadge>/<ProgressBar> in components/ui/tone-badge.tsx). Reaching
    // for a raw Tailwind status-color utility instead is how that vocabulary
    // quietly drifts: the same "warning" ends up bg-amber-500/15 in one file
    // and bg-amber-500/10 with an extra font-bold in another. tone.ts and
    // tone-badge.tsx are the source of truth and are exempt.
    files: ["**/*.tsx"],
    ignores: [
      "lib/ui/tone.ts",
      "components/ui/tone-badge.tsx",
      // Vendored from the @animate-ui shadcn-style registry (see
      // components.json) — not hand-authored app code, so it's upgraded by
      // re-vendoring rather than hand-edited to match our own conventions.
      "components/animate-ui/**",
      // A pixel-perfect ID card mockup measured in millimeters against a
      // real CR80 card — the print-fidelity exception noted in
      // docs/architecture/design-tokens.md, same category as an ID card's fixed hex.
      "app/(main)/departure-groups/\\[groupId\\]/components/id-card/id-card-studio.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='slice'][arguments.0.value=0][arguments.1.value=10][callee.object.callee.property.name='toISOString'][callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0]",
          message:
            "Use colomboDayKey() from @/lib/date instead of toISOString().slice(0, 10) — that reads UTC, not the agency's Asia/Colombo timezone.",
        },
        {
          selector:
            "Literal[value=/\\b(?:bg|text|border|ring|shadow)-(?:amber|emerald|sky|rose|red|green|blue|yellow|orange|teal|cyan|indigo|purple|pink)-(?:50|100|200|300|400|500|600|700|800|900|950)\\b/]",
          message:
            "Raw Tailwind status-color utility — use TONE_CLASS/TONE_BAR from @/lib/ui/tone or <ToneBadge>/<ProgressBar> from @/components/ui/tone-badge instead, so this status renders the same colour everywhere in the app.",
        },
        {
          // Allows rounded-[var(--radius-lg)], rounded-[min(var(--radius-md),10px)]
          // and rounded-[calc(var(--radius)-3px)] — all still the token
          // scale, just wrapped in an arbitrary-value bracket (see
          // components/ui/button.tsx and input-group.tsx). Only a literal
          // pixel/unit value with no --radius reference is banned.
          selector:
            "Literal[value=/\\brounded(?:-[a-z]{1,2})?-\\[(?!min\\(var\\(--radius|calc\\(var\\(--radius|var\\(--radius)[^\\]]*\\]/]",
          message:
            "Hardcoded arbitrary border-radius — use the --radius-* scale (rounded-sm … rounded-4xl, see app/globals.css and docs/architecture/design-tokens.md) instead of a literal rounded-[Npx].",
        },
        {
          selector:
            "Literal[value=/\\bshadow-(?:gray|slate|zinc|neutral|stone|black|white|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?\\b/]",
          message:
            "Raw-palette shadow color — use the default shadow scale (shadow-xs … shadow-lg) or Card's own layered shadow as precedent for a bespoke one, not a literal shadow-gray-*/shadow-black.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The bundled worker (npm run worker:build) is generated output, not source.
    "dist-worker/**",
  ]),
]);

export default eslintConfig;
