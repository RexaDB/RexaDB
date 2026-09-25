"use client";

import { useEffect } from "react";
import { logAppError } from "@/lib/error-logger";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const digest = typeof error.digest === "string" ? error.digest : String(error.digest ?? "");
    logAppError({
      errorType: "react-root-error",
      message: error.message ?? String(error),
      stack: error.stack ?? null,
      url: typeof window !== "undefined" ? window.location.href : null,
      componentStack: (error as Error & { componentStack?: string }).componentStack ?? digest ?? null,
      metadata: { digest: digest || null },
      appVersion:
        typeof window !== "undefined"
          ? (window as unknown as { __REXA_APP_VERSION?: string }).__REXA_APP_VERSION ?? null
          : null,
      os: typeof navigator !== "undefined" ? navigator.platform ?? null : null,
    });
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
      <p
        style={{
          color: "var(--muted-foreground, #888)",
          marginBottom: "1.5rem",
          maxWidth: "400px",
        }}
      >
        An unexpected error occurred. The error has been logged and we&apos;ll look into it.
      </p>
      <button
        onClick={() => reset()}
        style={{
          padding: "8px 20px",
          borderRadius: "6px",
          border: "1px solid var(--border, #ddd)",
          background: "var(--primary, #3b82f6)",
          color: "var(--primary-foreground, #fff)",
          cursor: "pointer",
          fontSize: "0.875rem",
        }}
      >
        Try again
      </button>
    </div>
  );
}
