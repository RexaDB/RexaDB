/**
 * One-click Sync to Stripe: invoke the deployed paykit-api edge function
 * (?action=sync-products) with the project's service_role key, which the
 * function accepts as admin without a user session.
 *
 * Pure helpers (testable) + shapes shared by the sidecar endpoint.
 */

export interface SyncInvokeRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, never>;
}

/**
 * Build the edge-function invoke request for sync-products.
 * serviceKey may be empty (masked/unreadable secrets) — the apikey header
 * is then omitted and only the mgmt owner-proof travels. At least one of
 * the two must be present.
 */
export function buildSyncInvokeRequest(
  projectRef: string,
  serviceKey: string,
  mgmtToken?: string,
): SyncInvokeRequest {
  const key = String(serviceKey || "").trim();
  const mgmt = String(mgmtToken || "").trim();
  if (!key && !mgmt) throw new Error("Missing service key and management token.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) {
    headers.apikey = key;
    headers.Authorization = `Bearer ${key}`;
  }
  if (mgmt) {
    headers["x-rexadb-mgmt"] = mgmt;
  }
  return {
    url: `https://${projectRef}.supabase.co/functions/v1/paykit-api?action=sync-products`,
    headers,
    body: {},
  };
}

/**
 * Pick a named key out of a Management API api-keys response.
 * Accepts the documented array shape plus common wrappers.
 */
export function pickApiKey(payload: unknown, name: string): string | null {
  const list: unknown = Array.isArray(payload)
    ? payload
    : (payload as any)?.api_keys ?? (payload as any)?.apiKeys ?? (payload as any)?.data ?? null;
  if (!Array.isArray(list)) return null;
  const want = String(name || "").toLowerCase();
  for (const entry of list) {
    const entryName = String((entry as any)?.name ?? "").toLowerCase();
    const key = String((entry as any)?.api_key ?? (entry as any)?.apiKey ?? "");
    if (entryName === want && key) return key;
  }
  return null;
}

/** Pick the service_role key out of a Management API api-keys response. */
export function pickServiceRoleKey(payload: unknown): string | null {
  return pickApiKey(payload, "service_role");
}

/**
 * All service_role keys (deduped). Projects can expose several (legacy JWT
 * alongside new-format keys); the function environment holds exactly one of
 * them, so callers should try each in turn.
 */
export function pickServiceRoleKeys(payload: unknown): string[] {
  const list: unknown = Array.isArray(payload)
    ? payload
    : (payload as any)?.api_keys ?? (payload as any)?.apiKeys ?? (payload as any)?.data ?? null;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const name = String((entry as any)?.name ?? "").toLowerCase();
    const key = String((entry as any)?.api_key ?? (entry as any)?.apiKey ?? "");
    if (name === "service_role" && key && !out.includes(key)) out.push(key);
  }
  return out;
}

const CANDIDATE_KEY_FIELDS = [
  "api_key",
  "apiKey",
  "secret",
  "secret_key",
  "secretKey",
  "key",
  "token",
  "value",
] as const;

/**
 * Every key-like value in an api-keys response, service_role-named entries
 * first. New-format secrets are often listed under other names ("secret",
 * …) while the function environment holds exactly one of them — trying
 * every candidate is the only robust match. Values under 20 chars are
 * never keys (ids, prefixes). Never log the values themselves.
 */
export function collectCandidateKeys(payload: unknown, maxCandidates = 8): string[] {
  const list: unknown = Array.isArray(payload)
    ? payload
    : (payload as any)?.api_keys ?? (payload as any)?.apiKeys ?? (payload as any)?.data ?? null;
  const out: string[] = [];
  const push = (key: unknown) => {
    if (typeof key !== "string") return;
    const trimmed = key.trim();
    if (trimmed.length < 20 || out.includes(trimmed)) return;
    if (out.length < maxCandidates) out.push(trimmed);
  };
  if (!Array.isArray(list)) return out;
  // Exact service_role matches first (most likely to be right).
  for (const entry of list) {
    if (String((entry as any)?.name ?? "").toLowerCase() !== "service_role") continue;
    push((entry as any)?.api_key);
    push((entry as any)?.apiKey);
  }
  // Then every other key-like value (new-format secrets live here).
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    for (const field of CANDIDATE_KEY_FIELDS) {
      push((entry as Record<string, unknown>)[field]);
    }
  }
  return out;
}

/** Pick the anon key out of a Management API api-keys response. */
export function pickAnonKey(payload: unknown): string | null {
  return pickApiKey(payload, "anon");
}

export interface SyncProductsSummary {
  products: number;
  withPrices: number;
  features: number;
}

/** Human message: deployed bundle predates the admin sync path. */
export const STALE_FUNCTIONS_MESSAGE =
  "Your deployed functions are from an older version and don't support one-click sync. Press Run setup to update them, then sync again.";

/** Human message: the call never reached function code (gateway/edge rejection). */
export const GATEWAY_BLOCKED_MESSAGE =
  "Supabase's gateway blocked the call before it reached your function — gateway JWT verification is likely still on, or the rollout hasn't finished. Re-run Setup (it disables gateway verification), wait about a minute, then sync again.";

/** Human message: live bundle, but its secret key differs. */
export const ENV_MISMATCH_MESSAGE =
  "The function is up to date, but its secret key doesn't match the project's — its environment may hold a rotated key. Re-run Setup to redeploy with fresh credentials, then sync again.";

/** Human message: live bundle with no secret key in its environment. */
export const NO_SERVICE_KEY_MESSAGE =
  "The deployed function has no secret key in its environment. Re-run Setup to redeploy; if it persists, check Edge Function secrets in the Supabase dashboard.";

/** Where a sync 401 actually came from (response-body triage). */
export type SyncAuthFailureKind =
  | "stale"
  | "gateway"
  | "env-mismatch"
  | "no-service-key-env";

/**
 * Classify a sync 401 by response body. Legacy bundles answer plain
 * {"error":"Unauthorized."}; current bundles attach a code; anything
 * non-JSON or gateway-shaped never reached function code.
 */
export function classifySyncAuthFailure(body: unknown): SyncAuthFailureKind {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (record.code === "admin-key-mismatch") return "env-mismatch";
    if (record.code === "no-service-key-env") return "no-service-key-env";
    if (typeof record.error === "string" && typeof record.message !== "string") {
      return "stale";
    }
  }
  return "gateway";
}

/** Human message for a classified sync 401. */
export function syncAuthFailureMessage(kind: SyncAuthFailureKind): string {
  switch (kind) {
    case "env-mismatch":
      return ENV_MISMATCH_MESSAGE;
    case "no-service-key-env":
      return NO_SERVICE_KEY_MESSAGE;
    case "gateway":
      return GATEWAY_BLOCKED_MESSAGE;
    case "stale":
    default:
      return STALE_FUNCTIONS_MESSAGE;
  }
}

/**
 * True for sync failures that must un-complete Setup (stale bundle, gateway
 * block, env mismatch): the project is not in a working state, so the UI
 * should offer Run setup instead of a Completed pill.
 */
export function isSyncBlockingError(message: unknown): boolean {
  if (typeof message !== "string" || !message) return false;
  return (
    message.includes("don't support one-click sync") ||
    message.includes("gateway blocked the call") ||
    message.includes("doesn't match the project's") ||
    message.includes("no secret key in its environment")
  );
}

/** Summarize a sync-products result payload for toasts. */
export function summarizeSyncResult(payload: unknown): SyncProductsSummary {
  const products = Array.isArray((payload as any)?.products)
    ? (payload as any).products
    : [];
  // The edge function reports camelCase (stripePriceId, featuresAttached);
  // tolerate snake_case too.
  const hasPrice = (p: any) => Boolean(p?.stripePriceId ?? p?.stripe_price_id);
  const attachedCount = (p: any) =>
    Array.isArray(p?.featuresAttached)
      ? p.featuresAttached.length
      : Array.isArray(p?.features_attached)
        ? p.features_attached.length
        : 0;
  return {
    products: products.length,
    withPrices: products.filter(hasPrice).length,
    features: products.reduce((sum: number, p: any) => sum + attachedCount(p), 0),
  };
}

export type TemplateFreshness = "current" | "stale" | "unknown";

/**
 * Compare a deployed bundle's template version against the current one.
 * A deployed function that responds but reports NO version predates
 * versioning and is therefore stale. Anything unreadable is unknown
 * (never blocks completion on unknowns).
 */
export function compareTemplateVersion(
  deployed: string | null | undefined,
  current: string,
): TemplateFreshness {
  if (deployed === null || deployed === undefined) return "unknown";
  const d = String(deployed).trim();
  if (!d) return "unknown";
  if (!String(current || "").trim()) return "unknown";
  return d === String(current).trim() ? "current" : "stale";
}
