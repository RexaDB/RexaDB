"use client";

import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { AuthCustomProvidersList } from "./auth-custom-providers-list";
import { AuthCustomProvidersTable } from "./auth-custom-providers-table";

interface AuthProvidersContentProps {
  viewMode: "grid" | "table";
  providers: AuthProviderConfig[];
  onManage: (provider: AuthProviderConfig) => void;
}

export function AuthProvidersContent({ viewMode, providers, onManage }: AuthProvidersContentProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {viewMode === "table" ? (
        <AuthCustomProvidersTable providers={providers} onManage={onManage} />
      ) : (
        <AuthCustomProvidersList providers={providers} onManage={onManage} />
      )}
    </div>
  );
}
