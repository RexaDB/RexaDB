"use client";

import { studioApi } from "@/lib/studio-backend/api-client";
import type { KVPermission, PermissionAction, GranteeType } from "@/lib/studio/types";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const KV_KEYS = {
  snippets: "workspace:snippets",
  dashboards: "workspace:dashboards",
  history: "workspace:history",
} as const;

const SHARED_KEY_PREFIX = "shared:";

async function ensureEntryId(key: string): Promise<string | null> {
  try {
    const res = await studioApi.get<{ data: { id: string; key: string; value: string }[] }>(
      "/api/kv-store?scope=owned"
    );
    const existing = res.data?.find((e) => e.key === key);
    return existing?.id ?? null;
  } catch {
    return null;
  }
}

async function createEntry(key: string, value: object, permissions?: KVPermission[]): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      key,
      value: JSON.stringify(value),
    };
    if (permissions) {
      body.permissions = permissions.map(p => {
        const perm: Record<string, unknown> = { action: p.action, type: p.granteeType };
        if (p.granteeId != null) perm.id = p.granteeId;
        return perm;
      });
    }
    const res = await studioApi.post<{ data: { id: string } }>("/api/kv-store", body);
    return res.data?.id ?? null;
  } catch {
    return null;
  }
}

async function deleteEntry(id: string): Promise<boolean> {
  try {
    await studioApi.del(`/api/kv-store/${id}`);
    return true;
  } catch {
    return false;
  }
}

async function getReceivedSharedItems<T = unknown>(): Promise<{ items: { id: string; key: string; value: T }[]; error: string | null }> {
  try {
    const res = await studioApi.get<{ data: { id: string; key: string; value: string }[] }>(
      "/api/kv-store?scope=shared"
    );
    const items = (res.data || []).map((e) => ({
      id: e.id,
      key: e.key,
      value: JSON.parse(e.value) as T,
    }));
    return { items, error: null };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Failed to fetch shared items" };
  }
}

async function updateEntry(id: string, value: object): Promise<boolean> {
  try {
    await studioApi.put(`/api/kv-store/${id}`, {
      value: JSON.stringify(value),
    });
    return true;
  } catch {
    return false;
  }
}

async function readEntry(key: string): Promise<object | null> {
  try {
    const res = await studioApi.get<{ data: { id: string; key: string; value: string }[] }>(
      "/api/kv-store?scope=owned"
    );
    const entry = res.data?.find((e) => e.key === key);
    if (!entry) return null;
    return JSON.parse(entry.value);
  } catch {
    return null;
  }
}

async function writeEntry(key: string, value: object): Promise<boolean> {
  const existingId = await ensureEntryId(key);
  if (existingId) {
    return updateEntry(existingId, value);
  }
  const newId = await createEntry(key, value);
  return newId !== null;
}

// --- Permission management ---

type GroupedPermissions = Record<string, { type: string; id?: string }[]>;
type ApiEntryResponse = { data: { id: string; permissions: GroupedPermissions } };

export async function getEntryPermissions(entryId: string): Promise<{ permissions: KVPermission[]; error: string | null }> {
  try {
    const res = await studioApi.get<ApiEntryResponse>(
      `/api/kv-store/${entryId}`
    );
    const grouped = res.data?.permissions;
    if (!grouped) return { permissions: [], error: null };
    const flat: KVPermission[] = [];
    for (const [action, grantees] of Object.entries(grouped)) {
      for (const g of grantees) {
        flat.push({
          action: action as PermissionAction,
          granteeType: g.type as GranteeType,
          granteeId: g.id ?? null,
        });
      }
    }
    return { permissions: flat, error: null };
  } catch (err) {
    return { permissions: [], error: err instanceof Error ? err.message : "Failed to fetch permissions" };
  }
}

export async function updateEntryPermissions(entryId: string, permissions: KVPermission[]): Promise<{ error: string | null }> {
  try {
    const mapped = permissions.map(p => {
      const perm: Record<string, unknown> = { action: p.action, type: p.granteeType };
      if (p.granteeId != null) perm.id = p.granteeId;
      return perm;
    });
    await studioApi.put(`/api/kv-store/${entryId}`, { permissions: mapped });
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update permissions" };
  }
}

// --- Sharing entries ---

export async function shareSnippetEntry(
  snippet: { id: string; name: string; query: string; folderId: string | null; createdAt: number },
  granteeType?: GranteeType,
  permissions?: KVPermission[]
): Promise<{ entryId: string | null; error: string | null }> {
  try {
    const key = `${SHARED_KEY_PREFIX}snippet:${snippet.id}`;
    const perms = permissions?.length
      ? permissions
      : [{ action: "read" as PermissionAction, granteeType: granteeType || "studio", granteeId: null as string | null }];
    const existingId = await ensureEntryId(key);
    let entryId: string | null;
    if (existingId) {
      await studioApi.put(`/api/kv-store/${existingId}`, {
        value: JSON.stringify(snippet),
        permissions: perms.map(p => {
          const perm: Record<string, unknown> = { action: p.action, type: p.granteeType };
          if (p.granteeId != null) perm.id = p.granteeId;
          return perm;
        }),
      });
      entryId = existingId;
    } else {
      entryId = await createEntry(key, snippet, perms);
    }
    return { entryId, error: entryId ? null : "Failed to create shared entry" };
  } catch (err) {
    return { entryId: null, error: err instanceof Error ? err.message : "Failed to share snippet" };
  }
}

export async function shareDashboardEntry(
  dashboard: { id: string; name: string; folderId: string | null; widgets: any[] },
  granteeType?: GranteeType,
  permissions?: KVPermission[]
): Promise<{ entryId: string | null; error: string | null }> {
  try {
    const key = `${SHARED_KEY_PREFIX}dashboard:${dashboard.id}`;
    const perms = permissions?.length
      ? permissions
      : [{ action: "read" as PermissionAction, granteeType: granteeType || "studio", granteeId: null as string | null }];
    const mappedPerms = perms.map(p => {
      const perm: Record<string, unknown> = { action: p.action, type: p.granteeType };
      if (p.granteeId != null) perm.id = p.granteeId;
      return perm;
    });
    const existingId = await ensureEntryId(key);
    let entryId: string | null;
    if (existingId) {
      await studioApi.put(`/api/kv-store/${existingId}`, {
        value: JSON.stringify(dashboard),
        permissions: mappedPerms,
      });
      entryId = existingId;
    } else {
      entryId = await createEntry(key, dashboard, perms);
    }
    return { entryId, error: entryId ? null : "Failed to create shared entry" };
  } catch (err) {
    return { entryId: null, error: err instanceof Error ? err.message : "Failed to share dashboard" };
  }
}

export async function unshareEntry(entryId: string): Promise<{ error: string | null }> {
  const ok = await deleteEntry(entryId);
  return { error: ok ? null : "Failed to unshare entry" };
}

export async function getReceivedSharedSnippets(): Promise<{ snippets: any[]; error: string | null }> {
  const { items, error } = await getReceivedSharedItems();
  if (error) return { snippets: [], error };
  const snippets = items.filter((i) => i.key.startsWith(`${SHARED_KEY_PREFIX}snippet:`)).map((i) => i.value);
  return { snippets, error: null };
}

export async function getReceivedSharedDashboards(): Promise<{ dashboards: any[]; error: string | null }> {
  const { items, error } = await getReceivedSharedItems();
  if (error) return { dashboards: [], error };
  const dashboards = items.filter((i) => i.key.startsWith(`${SHARED_KEY_PREFIX}dashboard:`)).map((i) => i.value);
  return { dashboards, error: null };
}

// --- Workspace storage ---

export async function getWorkspaceSnippets(
): Promise<{ folders: any[]; snippets: any[]; error: string | null }> {
  try {
    const data = await readEntry(KV_KEYS.snippets) as { folders?: any[]; snippets?: any[] } | null;
    return {
      folders: data?.folders ?? [],
      snippets: data?.snippets ?? [],
      error: null,
    };
  } catch (err) {
    return { folders: [], snippets: [], error: err instanceof Error ? err.message : "Failed to load snippets" };
  }
}

export async function saveWorkspaceSnippets(
  folders: any[],
  snippets: any[],
  allowEmpty = false,
): Promise<{ error: string | null }> {
  try {
    const ok = await writeEntry(KV_KEYS.snippets, { folders, snippets });
    return { error: ok ? null : "Failed to save snippets" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save snippets" };
  }
}

export async function getWorkspaceDashboards(
): Promise<{ dashboards: any[]; folders: any[]; error: string | null }> {
  try {
    const data = await readEntry(KV_KEYS.dashboards) as { dashboards?: any[]; folders?: any[] } | null;
    return {
      dashboards: data?.dashboards ?? [],
      folders: data?.folders ?? [],
      error: null,
    };
  } catch (err) {
    return { dashboards: [], folders: [], error: err instanceof Error ? err.message : "Failed to load dashboards" };
  }
}

export async function saveWorkspaceDashboards(
  dashboards: any[],
  folders: any[],
): Promise<{ error: string | null }> {
  try {
    const ok = await writeEntry(KV_KEYS.dashboards, { dashboards, folders });
    return { error: ok ? null : "Failed to save dashboards" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save dashboards" };
  }
}

export async function getWorkspaceHistory(
): Promise<{ history: any[]; error: string | null }> {
  try {
    const data = await readEntry(KV_KEYS.history) as { entries?: any[] } | null;
    return {
      history: data?.entries ?? [],
      error: null,
    };
  } catch (err) {
    return { history: [], error: err instanceof Error ? err.message : "Failed to load history" };
  }
}

export async function saveWorkspaceHistory(
  history: any[],
): Promise<{ error: string | null }> {
  try {
    const ok = await writeEntry(KV_KEYS.history, { entries: history });
    return { error: ok ? null : "Failed to save history" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save history" };
  }
}

export async function getWorkspaceMembers(): Promise<
  { id: string; name: string; email: string; avatarUrl: string | null }[]
> {
  try {
    const res = await studioApi.get<{ data: Array<{ id: string; name: string; email: string; avatarUrl: string | null }> }>(
      "/api/users"
    );
    return res.data ?? [];
  } catch {
    return [];
  }
}
