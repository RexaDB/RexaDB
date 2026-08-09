"use client";

import { useEffect } from "react";
import { logAppError } from "@/lib/error-logger";

interface AppErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
  errorType: string;
  title: string;
  message: string;
  resetLabel?: string;
  homeLabel?: string;
  titleColor?: string;
}

export function AppErrorPage({
  error,
  reset,
  errorType,
  title,
  message,
  resetLabel = "Try again",
  homeLabel = "Go home",
  titleColor,
}: AppErrorPageProps) {
  useEffect(() => {
    logAppError({
      errorType,
      message: error.message,
      stack: error.stack ?? null,
      url: typeof window !== "undefined" ? window.location.href : null,
      componentStack: null,
      metadata: { digest: error.digest },
      appVersion: null,
      os: null,
    });
  }, [error, errorType]);

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
      <h1
        style={{
          fontSize: "1.25rem",
          marginBottom: "0.5rem",
          ...(titleColor ? { color: titleColor } : {}),
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: "var(--muted-foreground, #888)",
          marginBottom: "1.5rem",
          maxWidth: "400px",
        }}
      >
        {message}
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
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
          {resetLabel}
        </button>
        <button
          onClick={() => (window.location.href = "/")}
          style={{
            padding: "8px 20px",
            borderRadius: "6px",
            border: "1px solid var(--border, #ddd)",
            background: "transparent",
            color: "var(--foreground, #000)",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          {homeLabel}
        </button>
      </div>
    </div>
  );
}
