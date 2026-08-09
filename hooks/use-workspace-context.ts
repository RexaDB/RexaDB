"use client";

import { useEffect, useState } from "react";
import { initStudioAuth, loadStudioAuth } from "@/lib/studio-backend/auth-store";
import { resolveUserEntitlement } from "@/lib/billing/entitlement-resolver";
import { loadStoredDisplayName } from "@/lib/auth/user-profile";
import { useAuthState } from "@/hooks/use-auth-state";

type StorageMode = "local" | "cloud";

interface WorkspaceContextOptions {
  connectionId: number;
  connectionName: string;
}

interface WorkspaceContextState {
  storageMode: StorageMode;
  workspaceId: string | null;
  accessToken: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  planCode: string;
  isProPlus: boolean;
  isLoading: boolean;
}

export function useWorkspaceContext({
  connectionId: _connectionId,
  connectionName: _connectionName,
}: WorkspaceContextOptions): WorkspaceContextState {
  const [auth, setAuth] = useState<{ userId: string; studioToken: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [planCode, setPlanCode] = useState("free");
  const [isProPlus, setIsProPlus] = useState(false);
  const { accessToken, userId: supabaseUserId, isSessionActive, user } = useAuthState();

  useEffect(() => {
    initStudioAuth().then(() => {
      setAuth(loadStudioAuth());
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!isSessionActive || !supabaseUserId || !accessToken) return;
    resolveUserEntitlement({ userId: supabaseUserId, accessToken }).then((ent) => {
      setPlanCode(ent.effectivePlanCode);
      setIsProPlus(ent.premiumActive);
    }).catch(() => {});
  }, [isSessionActive, supabaseUserId, accessToken]);

  const isConnected = auth !== null;
  const storageMode: StorageMode = isConnected ? "cloud" : "local";

  return {
    storageMode,
    workspaceId: auth?.userId ?? null,
    accessToken: auth?.studioToken ?? null,
    userId: auth?.userId ?? null,
    userEmail: user?.email ?? null,
    userName: loadStoredDisplayName() || null,
    planCode,
    isProPlus,
    isLoading,
  };
}
