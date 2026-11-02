"use client";

import { apiFetch, initApiBase } from "@/lib/api-base";
import { isDiagnosticsEnabled } from "@/lib/privacy-settings";

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
  const safe: ErrorLogPayload = {
    errorType: payload.errorType || "unknown",
    message: typeof payload.message === "string" ? payload.message : String(payload.message ?? ""),
    stack: typeof payload.stack === "string" ? payload.stack : null,
    url: typeof payload.url === "string" ? payload.url : null,
    componentStack: typeof payload.componentStack === "string" ? payload.componentStack : null,
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    appVersion: typeof payload.appVersion === "string" ? payload.appVersion : null,
    os: typeof payload.os === "string" ? payload.os : null,
  };
  const body = JSON.stringify(safe);

  if (body.length > 50_000) {
    console.warn("[error-logger] payload exceeds 50KB, truncating stack");
    const maxStack = 10_000;
    safe.stack = safe.stack?.slice(0, maxStack) ?? null;
    safe.componentStack = safe.componentStack?.slice(0, maxStack) ?? null;
  }

  if (!isDiagnosticsEnabled()) {
    await logLocally(safe);
    return;
  }

  try {
    const { getBackendClient } = await import("@/lib/supabase/backend-client");
    const supabase = await getBackendClient();
    await supabase.rpc("log_app_error", {
      p_error_type: safe.errorType,
      p_message: safe.message,
      p_stack: safe.stack,
      p_url: safe.url,
      p_component_stack: safe.componentStack,
      p_metadata: safe.metadata,
      p_app_version: safe.appVersion,
      p_os: safe.os,
    });
  } catch {
    await logLocally(safe);
  }
}

/** Write to the sidecar's log on this device; nothing is uploaded. */
async function logLocally(safe: ErrorLogPayload): Promise<void> {
  try {
    // The sidecar moves to another port when 3867 is taken, so ask for its
    // address instead of assuming it.
    await initApiBase();
    await apiFetch("/api/errors/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safe),
    });
  } catch {
    console.error("[error-logger] failed to send error to server", safe.message);
  }
}
