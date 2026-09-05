"use client";

import { API_BASE, apiFetch } from "@/lib/api-base";
import type {
  PaykitDraftState,
  PaykitProjectStatus,
} from "./types";

export { API_BASE };

interface SidecarOk<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as SidecarOk<T> | null;
  if (!json || json.success === false) {
    throw new Error(json?.error || `Request failed: ${path}`);
  }
  return json.data as T;
}

export type PushSchemaPhase = "schema" | "tables" | "all";

export interface PushSchemaResult {
  applied: number;
  total: number;
  phase: PushSchemaPhase;
}

export interface DeployFunctionsResult {
  results: Array<{ slug: string; deployed: boolean; verifyJwt: boolean | null; error?: string }>;
}

export interface SetSecretsResult {
  requested: string[];
}

export async function fetchPaykitStatus(
  token: string,
  ref: string,
): Promise<PaykitProjectStatus> {
  return postJson<PaykitProjectStatus>("/api/supabase-paykit/status", {
    token,
    ref,
  });
}

export async function pushPaykitSchema(
  token: string,
  ref: string,
  phase: PushSchemaPhase = "all",
): Promise<PushSchemaResult> {
  return postJson<PushSchemaResult>("/api/supabase-paykit/push-schema", {
    token,
    ref,
    phase,
  });
}

export interface DeployFunctionsInput {
  token: string;
  ref: string;
  drafts: PaykitDraftState;
}

export async function deployPaykitFunctions(
  input: DeployFunctionsInput,
): Promise<DeployFunctionsResult> {
  return postJson<DeployFunctionsResult>("/api/supabase-paykit/deploy", input);
}

export interface ExposeSchemaResult {
  exposed: boolean;
  via: "already" | "auto";
}

export interface SyncPaykitProductsResult {
  products: Array<{ stripe_price_id?: string | null } & Record<string, unknown>>;
}

export async function syncPaykitProducts(
  token: string,
  ref: string,
): Promise<SyncPaykitProductsResult> {
  return postJson<SyncPaykitProductsResult>("/api/supabase-paykit/sync-products", {
    token,
    ref,
  });
}

export interface RepairPaykitResult {
  applied: string[];
  warnings: string[];
  alreadyOk: boolean;
  status: PaykitProjectStatus | null;
}

/** Fills gaps in an existing setup (missing RLS, grants, exposure) — additive only. */
export async function repairPaykitProject(
  token: string,
  ref: string,
): Promise<RepairPaykitResult> {
  return postJson<RepairPaykitResult>("/api/supabase-paykit/repair", {
    token,
    ref,
  });
}

export async function exposePaykitSchema(
  token: string,
  ref: string,
): Promise<ExposeSchemaResult> {
  return postJson<ExposeSchemaResult>("/api/supabase-paykit/expose", {
    token,
    ref,
  });
}

export async function setPaykitSecrets(
  token: string,
  ref: string,
  secrets: Record<string, string>,
): Promise<SetSecretsResult> {
  if (Object.keys(secrets).length === 0) {
    throw new Error("No secrets provided.");
  }
  return postJson<SetSecretsResult>("/api/supabase-paykit/secrets", {
    token,
    ref,
    secrets,
  });
}

export interface StripeWebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  livemode: boolean;
  status: string;
}

/** Creates the Stripe webhook endpoint (URL + events pre-set) via the
 *  local sidecar — the secret key never goes through the browser CORS wall. */
export async function createStripeWebhookEndpoint(input: {
  secretKey: string;
  url: string;
  events: string[];
}): Promise<StripeWebhookEndpoint> {
  return postJson<StripeWebhookEndpoint>(
    "/api/stripe/create-webhook-endpoint",
    input,
  );
}

// ─── local draft persistence (device-local; secrets never stored) ─────

import {
  createEmptyDraftState,
  paykitDraftStorageKey,
  type PaykitDraftState as DraftState,
} from "./types";

export function loadPaykitDrafts(ref: string): DraftState {
  try {
    const raw = localStorage.getItem(paykitDraftStorageKey(ref));
    if (!raw) return createEmptyDraftState();
    const parsed = JSON.parse(raw) as DraftState;
    if (parsed.version !== 1 || !Array.isArray(parsed.plans)) {
      return createEmptyDraftState();
    }
    return {
      version: 1,
      features: Array.isArray(parsed.features) ? parsed.features : [],
      plans: parsed.plans,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return createEmptyDraftState();
  }
}

export function savePaykitDrafts(ref: string, state: DraftState): void {
  try {
    localStorage.setItem(
      paykitDraftStorageKey(ref),
      JSON.stringify({ ...state, updatedAt: Date.now() }),
    );
  } catch {
    // storage full / private mode — drafts stay in memory
  }
}
