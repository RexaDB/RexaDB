export function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

export function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePlanCode(plan: string | null | undefined) {
  return typeof plan === "string" && plan.trim() ? plan.trim() : "free";
}

type SupabaseQueryable = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: <T = unknown>() => PromiseLike<{ data: T | null; error: unknown }>;
      };
    };
  };
};

export type SubscriptionPlanRow = {
  code: string;
  cloud_enabled: boolean;
  max_connections: number | null;
  max_workspaces: number | null;
};

export type EntitlementComputationInput = {
  entitlementPlanCode: string;
  latestPaidPlan: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  planRowCloudEnabled: boolean | null | undefined;
  planRowMaxConnections: number | null | undefined;
  planRowMaxWorkspaces: number | null | undefined;
  accessEndsAt: number | null;
  updatesUntil: number | null;
};

export type EntitlementComputationConstants = {
  freeMaxConnections: number;
  freeMaxWorkspaces: number;
  offlineGraceMs: number;
};

export type ComputedEntitlementFields = {
  lastPaidPlanCode: string | null;
  status: string;
  cloudEnabled: boolean;
  maxConnections: number | null;
  maxWorkspaces: number | null;
  accessEndsAt: number | null;
  graceEndsAt: number | null;
  updatesUntil: number | null;
};

export function computeEntitlementFields(
  input: EntitlementComputationInput,
  constants: EntitlementComputationConstants,
): ComputedEntitlementFields {
  return {
    lastPaidPlanCode:
      normalizePlanCode(input.latestPaidPlan) !== "free"
        ? normalizePlanCode(input.latestPaidPlan)
        : input.entitlementPlanCode !== "free"
          ? input.entitlementPlanCode
          : null,
    status: input.subscriptionStatus?.trim() || "none",
    cloudEnabled: input.planRowCloudEnabled ?? input.entitlementPlanCode !== "free",
    maxConnections:
      typeof input.planRowMaxConnections === "number"
        ? input.planRowMaxConnections
        : input.entitlementPlanCode === "free"
          ? constants.freeMaxConnections
          : null,
    maxWorkspaces:
      typeof input.planRowMaxWorkspaces === "number"
        ? input.planRowMaxWorkspaces
        : input.entitlementPlanCode === "free"
          ? constants.freeMaxWorkspaces
          : null,
    accessEndsAt: input.accessEndsAt,
    graceEndsAt:
      input.entitlementPlanCode !== "otl" && input.accessEndsAt
        ? input.accessEndsAt + constants.offlineGraceMs
        : null,
    updatesUntil: input.updatesUntil,
  };
}

export async function resolveSubscriptionPlanRow(
  client: SupabaseQueryable,
  planCode: string,
): Promise<SubscriptionPlanRow | null> {
  const { data: planRow } = await client
    .from("subscription_plans")
    .select("code, cloud_enabled, max_connections, max_workspaces")
    .eq("code", planCode)
    .maybeSingle<SubscriptionPlanRow>();
  return planRow ?? null;
}

type SupabaseClient = {
  from: (table: string) => any;
};

export type ResolvedSubscriptions = {
  subscription: { plan: string | null; status?: string | null; ends_at?: string | null; updates_until?: string | null } | null;
  entitlementPlanCode: string;
  accessEndsAt: number | null;
  updatesUntil: number | null;
};

export async function fetchLatestPaidSubscription(
  client: SupabaseClient,
  userId: string,
): Promise<{ plan: string | null } | null> {
  const { data } = await client
    .from("user_subscriptions")
    .select("plan, created_at")
    .eq("user_id", userId)
    .neq("plan", "free")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export function resolveEntitlementSubscriptions(
  activeSubscription: ResolvedSubscriptions["subscription"],
  latestSubscription: ResolvedSubscriptions["subscription"],
): ResolvedSubscriptions {
  const subscription = activeSubscription ?? latestSubscription ?? null;
  const entitlementPlanCode = normalizePlanCode(subscription?.plan);
  const accessEndsAt = toTimestamp(subscription?.ends_at);
  const updatesUntil = toTimestamp(subscription?.updates_until);
  return { subscription, entitlementPlanCode, accessEndsAt, updatesUntil };
}
