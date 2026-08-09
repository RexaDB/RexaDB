export type EntitlementPlanCode =
  | "free"
  | "pro"
  | "team"
  | "enterprise"
  | "otl"
  | string;

type EntitlementFields = {
  entitlementPlanCode: EntitlementPlanCode;
  lastPaidPlanCode: EntitlementPlanCode | null;
  status: string;
  cloudEnabled: boolean;
  maxConnections: number | null;
  maxWorkspaces: number | null;
  accessEndsAt: number | null;
  graceEndsAt: number | null;
  updatesUntil: number | null;
  issuedAt: number;
  refreshAfter: number;
};

export type SignedEntitlementPayload = {
  version: 1;
  userId: string;
} & EntitlementFields;

export type SignedEntitlementEnvelope = {
  payload: SignedEntitlementPayload;
  payloadJson: string;
  signature: string;
};

export type StoredUserEntitlement = {
  userId: string;
  payloadJson: string;
  signature: string;
  lastObservedAt: number;
  syncedAt: number;
} & EntitlementFields;

export type StoredUserEntitlementInput = SignedEntitlementEnvelope & {
  userId: string;
  lastObservedAt?: number | null;
};

export type ResolvedUserEntitlement = {
  userId: string | null;
  payload: SignedEntitlementPayload;
  source: "server" | "cache" | "default";
  usingCached: boolean;
  refreshDue: boolean;
  premiumActive: boolean;
  graceActive: boolean;
  updatesExpired: boolean;
  clockRollbackDetected: boolean;
  revalidationRequired: boolean;
  effectiveNow: number;
  effectivePlanCode: EntitlementPlanCode;
  label: string;
  cloudEnabled: boolean;
  maxConnections: number | null;
  maxWorkspaces: number | null;
  accessEndsAt: number | null;
  graceEndsAt: number | null;
  updatesUntil: number | null;
  statusNotice: string | null;
};
