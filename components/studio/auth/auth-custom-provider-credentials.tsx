"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderCredentialsProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderCredentials({ state, onChange }: AuthCustomProviderCredentialsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Client ID</Label>
        <Input value={state.client_id} onChange={(e) => onChange({ ...state, client_id: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Client Secret</Label>
        <Input type="password" value={state.client_secret} onChange={(e) => onChange({ ...state, client_secret: e.target.value })} />
      </div>
    </div>
  );
}
