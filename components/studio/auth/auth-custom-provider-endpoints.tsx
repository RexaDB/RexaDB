"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderEndpointsProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderEndpoints({ state, onChange }: AuthCustomProviderEndpointsProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Issuer URL</Label>
      <Input value={state.issuer} onChange={(e) => onChange({ ...state, issuer: e.target.value })} placeholder="https://auth.company.com" />
    </div>
  );
}
