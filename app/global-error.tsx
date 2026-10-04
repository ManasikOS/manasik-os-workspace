"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort boundary — only renders if the root layout itself throws (a
 * per-route `error.tsx` handles everything below it). Must render its own
 * `<html>`/`<body>`, since it replaces the root layout entirely; kept
 * deliberately free of any app dependency (theming, fonts, providers) so it
 * can never itself fail to render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error, { tags: { boundary: "root" } });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Something went wrong
            </h1>
            <p style={{ color: "#666", marginBottom: "1.5rem" }}>
              {error.message || "An unexpected error occurred. Please try again."}
            </p>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "0.375rem",
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
