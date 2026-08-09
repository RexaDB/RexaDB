"use client";

import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

interface AuthCustomProvidersListProps {
  providers: AuthProviderConfig[];
  onManage: (provider: AuthProviderConfig) => void;
}

export function AuthCustomProvidersList({
  providers,
  onManage,
}: AuthCustomProvidersListProps) {
  if (!providers.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No custom providers yet.
      </div>
    );
  }

  return (
    <div className="p-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onManage(provider)}
          className="text-left rounded-lg border border-studio-border bg-studio-bg/60 p-4 flex items-center justify-between gap-4 hover:bg-studio-row-hover"
        >
          <div>
            <div className="text-sm font-semibold text-foreground">
              {provider.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {provider.identifier}
            </div>
          </div>
          <div
            className={`text-xs font-medium ${provider.enabled ? "text-emerald-400" : "text-muted-foreground"}`}
          >
            {provider.enabled ? "Enabled" : "Disabled"}
          </div>
        </button>
      ))}
    </div>
  );
}
