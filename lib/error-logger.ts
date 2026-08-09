"use client";

const API_BASE = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:3867`
  : "http://127.0.0.1:3867";

export interface ErrorLogPayload {
  errorType: string;
  message: string | null;
  stack: string | null;
  url: string | null;
  componentStack: string | null;
  metadata: Record<string, unknown>;
  appVersion: string | null;
  os: string | null;
}

export async function logAppError(payload: ErrorLogPayload): Promise<void> {
  const body = JSON.stringify(payload);

  if (body.length > 50_000) {
    console.warn("[error-logger] payload exceeds 50KB, truncating stack");
    const maxStack = 10_000;
    payload.stack = payload.stack?.slice(0, maxStack) ?? null;
  }

  try {
    const { supabase } = await import("@/lib/supabase/client");
    await supabase.rpc("log_app_error", {
      p_error_type: payload.errorType,
      p_message: payload.message,
      p_stack: payload.stack,
      p_url: payload.url,
      p_component_stack: payload.componentStack,
      p_metadata: payload.metadata,
      p_app_version: payload.appVersion,
      p_os: payload.os,
    });
  } catch {
    try {
      await fetch(`${API_BASE}/api/errors/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      console.error("[error-logger] failed to send error to server", payload.message);
    }
  }
}
