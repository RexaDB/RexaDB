"use client";

import { API_BASE, apiFetch } from "@/lib/api-base";
import { getStudioToken, getStudioUrl, clearAllStudioData, disconnectStudioWorkspace } from "./auth-store";

export function toggleRowSelection(
  index: number,
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
  setSelectedRows((prev) => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
}

export async function handleStudio401Error(err: unknown): Promise<boolean> {
  if (err instanceof StudioApiError && err.status === 401) {
    await clearAllStudioData();
    window.location.href = "/team/accept-invite";
    return true;
  }
  return false;
}

export class StudioApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const BASE_PROXY_PATH = "/api/studio-proxy";

async function handleResponse<T>(res: Response, clearSessionOn401 = true): Promise<T> {
  if (res.status === 401 && clearSessionOn401) {
    await clearAllStudioData();
    if (typeof window !== "undefined") {
      await disconnectStudioWorkspace();
    }
    throw new StudioApiError("Studio session expired", 401, "SESSION_EXPIRED");
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json() as Record<string, unknown>;
  } catch {
    const requestId = res.headers.get("X-Studio-Request-Id") || undefined;
    throw new StudioApiError(`Workspace API returned an invalid response (HTTP ${res.status})${requestId ? ` [${requestId}]` : ""}`, res.status, undefined, requestId);
  }

  if (!res.ok) {
    let message = json.error || "Studio API error";
    if (json.details && Array.isArray(json.details)) {
      const fieldErrors = json.details
        .map((d: { path?: string[]; message?: string }) =>
          d.path ? `${d.path.join(".")}: ${d.message || d}` : d.message || d
        )
        .join("; ");
      if (fieldErrors) message = fieldErrors;
    }
    const requestId = typeof json.requestId === "string" ? json.requestId : (res.headers.get("X-Studio-Request-Id") || undefined);
    throw new StudioApiError(`${message}${requestId ? ` [${requestId}]` : ""}`, res.status, typeof json.code === "string" ? json.code : undefined, requestId);
  }

  return json as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getStudioToken();
  const studioUrl = getStudioUrl();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Studio-Url": studioUrl,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await apiFetch(`${BASE_PROXY_PATH}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[studio-api] ${method} ${path} network failure; sidecar=${API_BASE}; workspace=${studioUrl}; error=${message}`);
    throw new Error(`Could not reach RexaDB sidecar at ${API_BASE} for ${path} (workspace ${studioUrl}): ${message}`);
  }

  try {
    const isPublicAuthRequest = method === "POST" && ["/auth/login", "/auth/login/totp", "/invites/accept"].includes(path);
    return await handleResponse<T>(res, !isPublicAuthRequest);
  } catch (error) {
    const requestId = res.headers.get("X-Studio-Request-Id");
    console.error(`[studio-api] ${method} ${path} failed; sidecar=${API_BASE}; workspace=${studioUrl}; status=${res.status}; requestId=${requestId || (error instanceof StudioApiError ? error.requestId : "none")}; error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function putBinary<T>(
  path: string,
  body: ArrayBuffer,
  contentType: string
): Promise<T> {
  const token = getStudioToken();
  const studioUrl = getStudioUrl();

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Studio-Url": studioUrl,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await apiFetch(`${BASE_PROXY_PATH}${path}`, {
    method: "PUT",
    headers,
    body,
  });

  return handleResponse<T>(res);
}

export const studioApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  putBinary: <T>(path: string, body: ArrayBuffer, contentType: string) => putBinary<T>(path, body, contentType),
};
