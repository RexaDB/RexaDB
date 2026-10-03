"use client";

import { apiFetch } from "@/lib/api-base";

let cachedAuth: StudioAuth | null = null;
let cachedUrl: string | null = null;
let initPromise: Promise<void> | null = null;

export interface StudioAuth {
  userId: string;
  studioToken: string;
}

async function fetchConfig() {
  const res = await apiFetch("/api/studio-config");
  const result = await res.json();
  return result.success ? (result.data as { studioUrl: string; studioToken: string; userId: string } | null) : null;
}

async function postConfig(config: { studioUrl: string; studioToken: string; userId: string }) {
  const res = await apiFetch("/api/studio-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Could not save local workspace config (${res.status})`);
  const result = await res.json();
  if (result.success !== true) throw new Error(result.error || "Could not save local workspace config");
}

async function deleteConfig() {
  await apiFetch("/api/studio-config", { method: "DELETE" });
}

export async function ensureActiveWorkspaceInList(): Promise<void> {
  if (!cachedAuth || !cachedUrl) return;
  try {
    const workspaces = await listWorkspaces();
    if (!workspaces.find((w) => w.studioUrl === cachedUrl)) {
      await addWorkspace({
        studioUrl: cachedUrl,
        studioToken: cachedAuth.studioToken,
        userId: cachedAuth.userId,
        name: cachedUrl,
      });
    }
  } catch {
    // best-effort
  }
}

export async function initStudioAuth(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const config = await fetchConfig();
      if (config) {
        cachedAuth = { userId: config.userId, studioToken: config.studioToken };
        cachedUrl = config.studioUrl;
        const recovered = await recoverLocalStudioUrl(config);
        cachedAuth = { userId: recovered.userId, studioToken: recovered.studioToken };
        cachedUrl = recovered.studioUrl;
        await ensureActiveWorkspaceInList();
      }
    } catch {
      // silent fail
    }
  })();
  return initPromise;
}

async function recoverLocalStudioUrl(config: { studioUrl: string; studioToken: string; userId: string }) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const server = await invoke<{ id: string; name: string; url: string | null } | null>("local_studio_recover", {
      studioUrl: config.studioUrl,
      userId: config.userId,
    });
    if (!server?.url || server.url === config.studioUrl) return config;

    const updated = { ...config, studioUrl: server.url };
    cachedUrl = updated.studioUrl;
    const replaceResponse = await apiFetch("/api/workspaces/replace-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldUrl: config.studioUrl, workspace: { ...updated, name: server.name } }),
    });
    const replaceResult = await replaceResponse.json();
    if (!replaceResponse.ok || replaceResult.success !== true) {
      throw new Error(replaceResult.error || `Could not update saved workspace URL (${replaceResponse.status})`);
    }
    await postConfig(updated);
    console.info(`[workspace-auth] restored local RexaDB Studio URL for server ${server.id}: ${config.studioUrl} -> ${server.url}`);
    return updated;
  } catch (error) {
    console.warn(`[workspace-auth] local server URL recovery did not run: ${error instanceof Error ? error.message : String(error)}`);
    return config;
  }
}

export function loadStudioAuth(): StudioAuth | null {
  return cachedAuth;
}

export function getStudioToken(): string | null {
  return cachedAuth?.studioToken ?? null;
}

export function getStudioUrl(): string {
  return cachedUrl || "";
}

export async function disconnectStudioWorkspace() {
  cachedAuth = null;
  cachedUrl = null;
  try {
    await apiFetch("/api/workspaces/deactivate", { method: "PUT" });
  } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem("workspace:active");
    window.dispatchEvent(
      new CustomEvent("workspace:changed", { detail: { connected: false } }),
    );
  }
}

export async function saveStudioAuth(auth: StudioAuth): Promise<void> {
  cachedAuth = auth;
  if (cachedUrl) {
    await postConfig({ studioUrl: cachedUrl, ...auth });
  }
}

export async function setStudioUrl(url: string): Promise<void> {
  cachedUrl = url;
  if (cachedAuth) {
    await postConfig({ studioUrl: url, ...cachedAuth });
  }
}

export async function setStudioConfig(config: { studioUrl: string; studioToken: string; userId: string }): Promise<void> {
  cachedAuth = { userId: config.userId, studioToken: config.studioToken };
  cachedUrl = config.studioUrl;
  await postConfig(config);
}

export async function clearAllStudioData(): Promise<void> {
  cachedAuth = null;
  cachedUrl = null;
  await deleteConfig();
}

export interface WorkspaceInfo {
  studioUrl: string;
  studioToken: string;
  userId: string;
  name: string;
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    const res = await apiFetch("/api/workspaces");
    const result = await res.json();
    return result.success ? (result.data as WorkspaceInfo[]) : [];
  } catch {
    return [];
  }
}

export async function addWorkspace(config: WorkspaceInfo): Promise<boolean> {
  try {
    const res = await apiFetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await res.json();
    if (result.success === true && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("workspace:changed"));
    }
    return result.success === true;
  } catch {
    return false;
  }
}

export async function removeWorkspace(studioUrl: string): Promise<boolean> {
  try {
    await apiFetch("/api/workspaces", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studioUrl }),
    });
    if (cachedUrl === studioUrl) {
      cachedAuth = null;
      cachedUrl = null;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("workspace:changed"));
    }
    return true;
  } catch {
    return false;
  }
}

export async function switchWorkspace(studioUrl: string): Promise<boolean> {
  try {
    const res = await apiFetch("/api/workspaces/activate", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studioUrl }),
    });
    const result = await res.json();
    if (!result.success) return false;
    const workspaces = await listWorkspaces();
    const ws = workspaces.find((w) => w.studioUrl === studioUrl);
    if (ws) {
      cachedAuth = { userId: ws.userId, studioToken: ws.studioToken };
      cachedUrl = ws.studioUrl;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("workspace:active", "1");
      window.dispatchEvent(new CustomEvent("workspace:changed", { detail: { connected: true } }));
    }
    return true;
  } catch {
    return false;
  }
}
