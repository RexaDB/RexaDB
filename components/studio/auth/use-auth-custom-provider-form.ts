import { useEffect, useState } from "react";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { buildCustomProviderForm } from "./auth-custom-provider-build";
import { parseCustomProviderForm } from "./auth-custom-provider-parse";
import type { CustomProviderFormState } from "./auth-custom-provider-types";
interface UseAuthCustomProviderFormProps {
  config: AuthProviderConfig | null;
  onSave: (payload: AuthProviderConfig) => Promise<AuthProviderConfig>;
  onSaved: () => void;
}
export function useAuthCustomProviderForm({ config, onSave, onSaved }: UseAuthCustomProviderFormProps) {
  const [state, setState] = useState<CustomProviderFormState>(() => buildCustomProviderForm(config));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setState(buildCustomProviderForm(config));
    setError(null);
  }, [config]);
  const save = async () => {
    const parsed = parseCustomProviderForm(state);
    if (!parsed.ok) return setError(parsed.error);
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.value);
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save provider.");
    } finally {
      setSaving(false);
    }
  };
  return { state, setState, error, saving, save };
}
