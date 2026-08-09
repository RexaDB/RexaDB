"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderDiscoveryProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderDiscoveryFields({ state, onChange }: AuthCustomProviderDiscoveryProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Discovery URL</Label>
      <Input value={state.discovery_url} onChange={(e) => onChange({ ...state, discovery_url: e.target.value })} placeholder="https://issuer/.well-known/openid-configuration" />
      <p className="text-xs text-muted-foreground">{"Leave empty to use {issuer}/.well-known/openid-configuration."}</p>
    </div>
  );
}
