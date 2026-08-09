"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderManualProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderManualFields({ state, onChange }: AuthCustomProviderManualProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Authorization URL</Label>
        <Input value={state.authorization_url} onChange={(e) => onChange({ ...state, authorization_url: e.target.value })} placeholder="https://auth.company.com/oauth/authorize" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Token URL</Label>
        <Input value={state.token_url} onChange={(e) => onChange({ ...state, token_url: e.target.value })} placeholder="https://auth.company.com/oauth/token" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Userinfo URL</Label>
        <Input value={state.userinfo_url} onChange={(e) => onChange({ ...state, userinfo_url: e.target.value })} placeholder="https://auth.company.com/oauth/userinfo" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">JWKS URI</Label>
        <Input value={state.jwks_uri} onChange={(e) => onChange({ ...state, jwks_uri: e.target.value })} placeholder="https://auth.company.com/.well-known/jwks.json" />
      </div>
    </div>
  );
}
