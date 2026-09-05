// PayKit billing scaffolding for Supabase-managed (smgt) user projects.
//
// This module is intentionally separate from RexaDB's own billing
// (`lib/billing/*`, user_subscriptions / entitlement edge function).
// Everything here targets the USER's connected Supabase project via their
// Management API token — RexaDB never touches its own backend here.

export type PaykitFeatureType = "boolean" | "metered";
export type PaykitResetInterval = "day" | "week" | "month" | "year";
export type PaykitPriceInterval = "month" | "year";

export interface PaykitFeatureDraft {
  /** lowercase alphanumeric + dashes/underscores, max 64 chars */
  id: string;
  type: PaykitFeatureType;
  /** description shown in UI only, not sent to Stripe */
  description?: string;
}

export interface PaykitPlanFeatureInclude {
  featureId: string;
  /** required for metered features */
  limit?: number | null;
  /** required for metered features */
  reset?: PaykitResetInterval | null;
}

export interface PaykitPlanDraft {
  id: string;
  name: string;
  /** mutually exclusive set; typical value "base" */
  group: string;
  /** exactly one default per group (usually the free tier) */
  default?: boolean;
  /** omit for free plans */
  priceAmount?: number | null;
  priceInterval?: PaykitPriceInterval | null;
  priceCurrency?: string | null;
  includes: PaykitPlanFeatureInclude[];
}

export interface PaykitDraftState {
  version: 1;
  features: PaykitFeatureDraft[];
  plans: PaykitPlanDraft[];
  updatedAt: number;
}

// ─── Edge function deployment descriptors ──────────────────────────────
// `verifyJwt: false` == `supabase functions deploy --no-verify-jwt`.
// Gateway JWT verification stays OFF on both functions by design — all auth
// is enforced in-function instead: Stripe-Signature on the webhook receiver,
// per-action user-JWT checks plus the service_role admin path on the API.
// (The gateway cannot tell our service_role calls from anonymous ones on
// newer key formats, so leaving it on breaks one-click sync.)

export const PAYKIT_WEBHOOK_SLUG = "paykit-webhook";
export const PAYKIT_API_SLUG = "paykit-api";

/** Events pre-selected when the webhook endpoint is registered in Stripe. */
export const PAYKIT_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "payment_method.attached",
  "payment_method.updated",
  "payment_method.detached",
  "customer.created",
  "customer.updated",
];

export interface PaykitFunctionSpec {
  slug: string;
  name: string;
  /** false → deployed with --no-verify-jwt */
  verifyJwt: boolean;
  /** path inside resources/paykit-functions */
  sourceDir: string;
  entrypoint: string;
}

export const PAYKIT_FUNCTIONS: PaykitFunctionSpec[] = [
  {
    slug: PAYKIT_WEBHOOK_SLUG,
    name: "PayKit Stripe webhook",
    verifyJwt: false,
    sourceDir: "paykit-webhook",
    entrypoint: "index.ts",
  },
  {
    slug: PAYKIT_API_SLUG,
    name: "PayKit billing API",
    verifyJwt: false,
    sourceDir: "paykit-api",
    entrypoint: "index.ts",
  },
];

// Secrets set via Management API (supabase secrets set equivalent).
// Values are never persisted in RexaDB — only presence (masked) is read back.
export const PAYKIT_REQUIRED_SECRETS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export type PaykitRequiredSecret = (typeof PAYKIT_REQUIRED_SECRETS)[number];

// ─── Remote status ─────────────────────────────────────────────────────

export interface PaykitTableStatus {
  table: string;
  present: boolean;
  /** relrowsecurity per table; null when the status check couldn't read it */
  rlsEnabled: boolean | null;
}

export interface PaykitFunctionStatus {
  slug: string;
  deployed: boolean;
  verifyJwt: boolean | null;
  version?: string | null;
  /** deployed bundle template version; null when unreadable */
  templateVersion?: string | null;
}

export interface PaykitProjectStatus {
  ref: string;
  tables: PaykitTableStatus[];
  schemaExists: boolean;
  schemaReady: boolean;
  functions: PaykitFunctionStatus[];
  secretsPresent: Record<string, boolean>;
  secretsReady: boolean;
  webhookUrl: string;
  /** whether the paykit schema is exposed via PostgREST (needed by the Edge Functions); null when unknown */
  postgrestExposed: boolean | null;
  /** service_role holds the required privileges on every present table; null when the check failed */
  grantsReady: boolean | null;
  /** a deployed paykit-api bundle reports an older template than current; null when unknown */
  functionsStale: boolean | null;
  /** non-fatal notes, e.g. functions list unavailable for this token */
  warnings: string[];
}

export function paykitWebhookUrl(ref: string): string {
  return `https://${ref}.supabase.co/functions/v1/${PAYKIT_WEBHOOK_SLUG}`;
}

export function paykitApiUrl(ref: string): string {
  return `https://${ref}.supabase.co/functions/v1/${PAYKIT_API_SLUG}`;
}

export const PAYKIT_DRAFT_STORAGE_PREFIX = "rexadb-paykit-drafts:";

export function paykitDraftStorageKey(ref: string): string {
  return `${PAYKIT_DRAFT_STORAGE_PREFIX}${ref}`;
}

export function createEmptyDraftState(): PaykitDraftState {
  return {
    version: 1,
    features: [],
    plans: [
      {
        id: "free",
        name: "Free",
        group: "base",
        default: true,
        priceAmount: null,
        priceInterval: null,
        includes: [],
      },
    ],
    updatedAt: Date.now(),
  };
}
