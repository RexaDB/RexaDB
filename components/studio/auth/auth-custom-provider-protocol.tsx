"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomProviderFormState, ProviderProtocol } from "./auth-custom-provider-types";

interface AuthCustomProviderProtocolProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderProtocol({ state, onChange }: AuthCustomProviderProtocolProps) {
  const update = (patch: Partial<CustomProviderFormState>) => onChange({ ...state, ...patch });
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Configuration Method</Label>
      <Select value={state.protocol} onValueChange={(value) => update({ protocol: value as ProviderProtocol })}>
        <SelectTrigger><SelectValue placeholder="Select configuration method" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="oidc">Auto-discovery (Recommended)</SelectItem>
          <SelectItem value="oauth2">Manual configuration</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
