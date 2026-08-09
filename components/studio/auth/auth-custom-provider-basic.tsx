"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { CustomProviderFormState } from "./auth-custom-provider-types";

interface AuthCustomProviderBasicProps {
  state: CustomProviderFormState;
  isEditMode: boolean;
  onChange: (next: CustomProviderFormState) => void;
}

export function AuthCustomProviderBasic({ state, isEditMode, onChange }: AuthCustomProviderBasicProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Provider Identifier</Label>
        <InputGroup>
          <InputGroupAddon>custom:</InputGroupAddon>
          <InputGroupInput
            value={state.identifier}
            disabled={isEditMode}
            onChange={(e) => onChange({ ...state, identifier: e.target.value.replace(/^custom:/i, "").trimStart() })}
            placeholder="my-company"
          />
        </InputGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Display Name</Label>
        <Input value={state.name} onChange={(e) => onChange({ ...state, name: e.target.value })} placeholder="My Provider" />
      </div>
    </div>
  );
}
