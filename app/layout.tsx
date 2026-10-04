import type { Metadata } from "next";
import { Noto_Kufi_Arabic, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { EnvironmentBanner } from "@/components/environment-banner";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const arabic = Noto_Kufi_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
});
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plusJakartaSans",
  weight: ["200", "300", "400", "500", "600", "700"],
  subsets: ["latin"],
});

/**
 * Tenant-neutral fallback — this root layout also renders /login, /signup
 * and every other pre-session route, where there is no agency to name yet.
 * `app/(main)/layout.tsx` overrides this with the signed-in agency's own
 * name once one is known (Phase 5 of
 * docs/architecture/multi-tenancy-implementation-plan.md — de-hardcoding the single
 * tenant this app shipped with).
 */
export const metadata: Metadata = {
  title: {
    template: "Manasik OS",
    default: "Manasik OS",
  },
  description:
    "Hajj & Umrah agency operations — leads, departure groups, documents, visa, finance and reporting in one workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${arabic.variable} h-full antialiased`}
    >
      <body className="" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          storageKey="theme"
          defaultTheme="light"
          enableSystem={false}
        >
          <EnvironmentBanner />
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
          <SpeedInsights />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
