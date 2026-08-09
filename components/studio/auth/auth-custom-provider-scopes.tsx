"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderScopesProps {
  state: CustomProviderFormState;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderScopes({
  state,
  onChange,
}: AuthCustomProviderScopesProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Scopes</Label>
        <Input
          value={state.scopes}
          onChange={(e) => onChange({ ...state, scopes: e.target.value })}
          placeholder="openid, email, profile"
        />
      </div>
      <label className="flex items-center justify-between gap-4 border border-studio-border rounded-lg px-4 py-2">
        <div>
          <div className="text-sm font-medium text-foreground">
            Allow Users Without Email
          </div>
          <div className="text-xs text-muted-foreground">
            Allow login even if the provider returns no email.
          </div>
        </div>
        <Switch
          checked={state.email_optional}
          onCheckedChange={(value) =>
            onChange({ ...state, email_optional: value })
          }
        />
      </label>
    </div>
  );
}
