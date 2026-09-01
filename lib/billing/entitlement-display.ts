import {
  DEFAULT_FREE_MAX_CONNECTIONS,
} from "@/lib/billing/entitlement-constants";
import type { ResolvedUserEntitlement } from "@/lib/billing/entitlement-types";

function formatDate(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString();
}

export function formatEntitlementPlanLabel(planCode: string | null | undefined) {
  if (!planCode) return "Free Plan";
  return `${planCode.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())} Plan`;
}

export function buildEntitlementProfileMeta(entitlement: ResolvedUserEntitlement) {
  if (entitlement.effectivePlanCode === "otl") {
    if (!entitlement.updatesUntil) return "Perpetual license";
    const label = formatDate(entitlement.updatesUntil);
    return entitlement.updatesExpired ? `Updates expired ${label}` : `Updates until ${label}`;
  }

  if (entitlement.effectivePlanCode === "free") {
    return `Cloud disabled • Up to ${DEFAULT_FREE_MAX_CONNECTIONS} connections`;
  }

  return `Cloud ${entitlement.cloudEnabled ? "enabled" : "disabled"} • Settings sync ${entitlement.cloudEnabled ? "on" : "off"} • Connections: ${entitlement.maxConnections ?? "unlimited"}`;
}

export function buildEntitlementCacheMessage(entitlement: ResolvedUserEntitlement) {
  return entitlement.statusNotice;
}

function buildEntitlementWorkspaceSummary(entitlement: ResolvedUserEntitlement) {
  if (entitlement.maxWorkspaces === null) return "Unlimited workspaces";
  if (entitlement.maxWorkspaces <= 0) return "Workspaces unavailable on this plan";
  return `${entitlement.maxWorkspaces} workspace${entitlement.maxWorkspaces === 1 ? "" : "s"} included`;
}
