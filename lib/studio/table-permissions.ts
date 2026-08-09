export type SupabaseAuthUserOption = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  providers: string[];
  createdAt: string | null;
  rawAppMetaData: Record<string, unknown>;
  rawUserMetaData: Record<string, unknown>;
};

export type TablePermissionContext =
  | null
  | {
      kind: "role";
      role: string;
      label: string;
    }
  | {
      kind: "supabase-user";
      userId: string;
      role: string;
      label: string;
      email: string | null;
      phone: string | null;
      rawAppMetaData: Record<string, unknown>;
      rawUserMetaData: Record<string, unknown>;
    };

export type QueryExecutionContext =
  | {
      kind: "role";
      role: string;
    }
  | {
      kind: "supabase-user";
      userId: string;
      role: string;
      email: string | null;
      phone: string | null;
      claims: Record<string, unknown>;
    };

export const DEFAULT_TABLE_PERMISSION_OPTION_VALUE = "__default__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function getTablePermissionContextKey(context: TablePermissionContext) {
  if (!context) return DEFAULT_TABLE_PERMISSION_OPTION_VALUE;
  if (context.kind === "role") {
    return `role:${context.role}`;
  }
  return `user:${context.userId}`;
}

export function areTablePermissionContextsEqual(
  left: TablePermissionContext,
  right: TablePermissionContext,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "role" && right.kind === "role") {
    return left.role === right.role && left.label === right.label;
  }
  if (left.kind === "supabase-user" && right.kind === "supabase-user") {
    return left.userId === right.userId
      && left.role === right.role
      && left.label === right.label
      && left.email === right.email
      && left.phone === right.phone
      && JSON.stringify(left.rawAppMetaData) === JSON.stringify(right.rawAppMetaData)
      && JSON.stringify(left.rawUserMetaData) === JSON.stringify(right.rawUserMetaData);
  }
  return false;
}

export function createRolePermissionContext(role: string): TablePermissionContext {
  const normalizedRole = String(role || "").trim();
  if (!normalizedRole) return null;
  return {
    kind: "role",
    role: normalizedRole,
    label: normalizedRole,
  };
}

export function createSupabaseUserPermissionContext(
  user: SupabaseAuthUserOption,
): TablePermissionContext {
  const label = String(
    user.email
      || user.phone
      || user.displayName
      || user.id,
  ).trim();

  return {
    kind: "supabase-user",
    userId: String(user.id || "").trim(),
    role: String(user.role || "authenticated").trim() || "authenticated",
    label: label || String(user.id || "").trim(),
    email: user.email ?? null,
    phone: user.phone ?? null,
    rawAppMetaData: normalizeJsonRecord(user.rawAppMetaData),
    rawUserMetaData: normalizeJsonRecord(user.rawUserMetaData),
  };
}

export function buildQueryExecutionContext(
  context: TablePermissionContext,
): QueryExecutionContext | null {
  if (!context) return null;
  if (context.kind === "role") {
    return {
      kind: "role",
      role: context.role,
    };
  }
  return {
    kind: "supabase-user",
    userId: context.userId,
    role: context.role,
    email: context.email,
    phone: context.phone,
    claims: {
      sub: context.userId,
      role: context.role,
      email: context.email ?? undefined,
      phone: context.phone ?? undefined,
      app_metadata: normalizeJsonRecord(context.rawAppMetaData),
      user_metadata: normalizeJsonRecord(context.rawUserMetaData),
    },
  };
}
