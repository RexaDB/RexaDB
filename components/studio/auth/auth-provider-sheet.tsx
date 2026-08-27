"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { AuthCustomProviderForm } from "./auth-custom-provider-form";

interface AuthProviderSheetProps {
  open: boolean;
  config: AuthProviderConfig | null;
  onSave: (payload: AuthProviderConfig) => Promise<AuthProviderConfig>;
  onOpenChange: (open: boolean) => void;
}

export function AuthProviderSheet({ open, config, onSave, onOpenChange }: AuthProviderSheetProps) {
  const { appShellLayout, modernUiLayout } = useGlobalStudioSettings();
  const shellLayout = appShellLayout || modernUiLayout;
  const label = config?.name || "Custom Provider";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={!shellLayout}>
      <SheetContent side="right" contained={shellLayout} className="bg-studio-bg border-studio-border text-foreground w-[min(520px,92vw)] p-0 flex flex-col">
        <SheetHeader className="px-6 py-5 border-b border-studio-border">
          <SheetTitle className="text-sm font-semibold">{label}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">Manage custom providers stored in auth.custom_oauth_providers.</SheetDescription>
        </SheetHeader>
        <AuthCustomProviderForm config={config} onSave={onSave} onSaved={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
