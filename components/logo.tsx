"use client";

import { useTheme } from "next-themes";

/**
 * Shared SVG body — exact content of both light-logo.svg and logo-dark.svg.
 * The only difference between the two files is the color palette, so we
 * parameterise the three colours and keep a single component.
 *
 * Rendered inline (not via <Image>) so the page's @font-face rules —
 * including the Next.js self-hosted Noto Kufi Arabic — are visible to the
 * SVG's embedded <style>.
 */
function LogoSvg({
  className,
  accentColor,
  textColor,
}: {
  className?: string;
  accentColor: string; // arabic text + dots + "OS"
  textColor: string; // "Manasik" latin text
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1080"
      height="1080"
      viewBox="0 0 1080 1080"
      className={className}
    >
      <defs>
        <style>{`
          .logo-arabic {
            font-size: 285.267px;
            font-family: var(--font-arabic), "Noto Kufi Arabic";
            font-weight: 500;
            text-anchor: middle;
            text-transform: uppercase;
            fill: ${accentColor};
          }
          .logo-name {
            font-size: 155.783px;
            font-family: "Plus Jakarta Sans";
            font-weight: 500;
            text-anchor: middle;
            fill: ${textColor};
          }
          .logo-os {
            font-size: 140.465px;
            font-family: "Plus Jakarta Sans";
            font-weight: 700;
            text-anchor: middle;
            text-transform: uppercase;
            fill: ${accentColor};
          }
          .logo-accent {
            fill: ${accentColor};
          }
          .logo-accent-path {
            fill: ${accentColor};
            fill-rule: evenodd;
          }
        `}</style>
      </defs>
      <text
        id="مناسك"
        className="logo-arabic"
        transform="matrix(1.267, 0, 0, 1.267, 546.683, 742.686)"
      >
        <tspan x="0">مناسك</tspan>
      </text>
      <text
        id="Manasik"
        className="logo-name"
        transform="matrix(1.16, 0, 0, 1.16, 423.645, 945.752)"
      >
        <tspan x="0">Manasik</tspan>
      </text>
      <text
        id="OS"
        className="logo-os"
        transform="matrix(1.143, 0, 0, 1.143, 884.886, 947.844)"
      >
        <tspan x="0">OS</tspan>
      </text>
      <circle className="logo-accent" cx="539.469" cy="135.5" r="19.281" />
      <circle className="logo-accent" cx="539.469" cy="241.484" r="19.281" />
      <circle className="logo-accent" cx="539.469" cy="347.469" r="19.281" />
      <path
        className="logo-accent-path"
        d="M655.087,116.227A19.271,19.271,0,1,1,635.816,135.5,19.271,19.271,0,0,1,655.087,116.227Z"
      />
      <path
        className="logo-accent-path"
        d="M655.087,222.214a19.271,19.271,0,1,1-19.271,19.271A19.271,19.271,0,0,1,655.087,222.214Z"
      />
      <path
        className="logo-accent-path"
        d="M655.087,328.2a19.271,19.271,0,1,1-19.271,19.27A19.27,19.27,0,0,1,655.087,328.2Z"
      />
      <path
        className="logo-accent-path"
        d="M423.842,328.2a19.271,19.271,0,1,1-19.271,19.27A19.269,19.269,0,0,1,423.842,328.2Z"
      />
    </svg>
  );
}

/** Exact colours from light-logo.svg */
export function LightLogo({ className }: { className?: string }) {
  return (
    <LogoSvg className={className} accentColor="#009dff" textColor="#0b1726" />
  );
}

/** Exact colours from logo-dark.svg */
export function DarkLogo({ className }: { className?: string }) {
  return (
    <LogoSvg className={className} accentColor="#35b5ff" textColor="#f5f7fa" />
  );
}

/**
 * Automatically switches between LightLogo and DarkLogo based on the current
 * theme (next-themes). Safe to use anywhere in the app.
 */
export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? (
    <DarkLogo className={className} />
  ) : (
    <LightLogo className={className} />
  );
}
