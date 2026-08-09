"use client";

import { useMemo, useState } from "react";
import { useAuthProviderConfigs } from "@/hooks/use-auth-provider-configs";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { AuthProviderSheet } from "./auth-provider-sheet";
import { AuthProvidersActions } from "./auth-providers-actions";
import { AuthProvidersContent } from "./auth-providers-content";
import { AuthSectionHeader } from "./auth-section-header";

interface AuthProvidersViewProps {
  connectionString: string;
  enabled: boolean;
}

export function AuthProvidersView({ connectionString, enabled }: AuthProvidersViewProps) {
  const [selectedProvider, setSelectedProvider] = useState<AuthProviderConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const { configsByIdentifier, loading, error, refresh, saveConfig } = useAuthProviderConfigs(connectionString, enabled);
  const visibleProviders = useMemo(() => Array.from(configsByIdentifier.values()), [configsByIdentifier]);

  if (!enabled) {
    return <div className="p-6 text-sm text-muted-foreground">Auth schema not available for this connection.</div>;
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <AuthSectionHeader
        title="Sign In / Providers"
        description=""
        onRefresh={refresh}
        loading={loading}
        countLabel={`${visibleProviders.length} providers`}
        showSearch={false}
        actions={
          <AuthProvidersActions
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onAdd={() => { setIsCreating(true); setSelectedProvider(null); }}
          />
        }
      />
      {error ? <div className="px-6 py-3 text-xs text-red-200 border-b border-red-500/30 bg-red-500/10">{error}</div> : null}
      <AuthProvidersContent
        viewMode={viewMode}
        providers={visibleProviders}
        onManage={(provider) => { setIsCreating(false); setSelectedProvider(provider); }}
      />
      <AuthProviderSheet
        open={isCreating || !!selectedProvider}
        config={isCreating ? null : selectedProvider}
        onSave={saveConfig}
        onOpenChange={(open) => { if (!open) { setSelectedProvider(null); setIsCreating(false); } }}
      />
    </div>
  );
}
