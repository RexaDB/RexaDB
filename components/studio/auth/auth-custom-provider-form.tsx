"use client";

import { Button } from "@/components/ui/button";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { AuthCustomProviderBasic } from "./auth-custom-provider-basic";
import { AuthCustomProviderCredentials } from "./auth-custom-provider-credentials";
import { AuthCustomProviderDiscoveryFields } from "./auth-custom-provider-discovery-fields";
import { AuthCustomProviderEndpoints } from "./auth-custom-provider-endpoints";
import { AuthCustomProviderManualFields } from "./auth-custom-provider-manual-fields";
import { AuthCustomProviderProtocol } from "./auth-custom-provider-protocol";
import { AuthCustomProviderScopes } from "./auth-custom-provider-scopes";
import { useAuthCustomProviderForm } from "./use-auth-custom-provider-form";

interface AuthCustomProviderFormProps {
  config: AuthProviderConfig | null;
  onSave: (payload: AuthProviderConfig) => Promise<AuthProviderConfig>;
  onSaved: () => void;
}

export function AuthCustomProviderForm({
  config,
  onSave,
  onSaved,
}: AuthCustomProviderFormProps) {
  const { state, setState, error, save, saving } = useAuthCustomProviderForm({
    config,
    onSave,
    onSaved,
  });
  const isEditMode = Boolean(config);
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </div>
      ) : null}
      <AuthCustomProviderBasic
        state={state}
        isEditMode={isEditMode}
        onChange={setState}
      />
      <AuthCustomProviderProtocol state={state} onChange={setState} />
      <AuthCustomProviderEndpoints state={state} onChange={setState} />
      {state.protocol === "oidc" ? (
        <AuthCustomProviderDiscoveryFields state={state} onChange={setState} />
      ) : null}
      {state.protocol === "oauth2" ? (
        <AuthCustomProviderManualFields state={state} onChange={setState} />
      ) : null}
      <AuthCustomProviderCredentials state={state} onChange={setState} />
      <AuthCustomProviderScopes state={state} onChange={setState} />
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Provider"}
        </Button>
      </div>
    </div>
  );
}
