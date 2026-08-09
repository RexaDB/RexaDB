"use client";

import { SettingsView } from "@/components/studio/settings-view";
import { useAppSettings } from "@/hooks/use-app-settings";

export function AppSettingsView({
  planCode,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
}: {
  planCode?: string;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
}) {
  const studio = useAppSettings(planCode);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <SettingsView studio={studio as any} onOpenThemeCreator={onOpenThemeCreator} onOpenIconThemeCreator={onOpenIconThemeCreator} />
      </div>
    </div>
  );
}
