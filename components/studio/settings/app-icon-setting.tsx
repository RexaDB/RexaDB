"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingRow } from "@/components/studio/settings-view";
import { Button } from "@/components/ui/button";
import {
  APP_ICON_PRESETS,
  CUSTOM_APP_ICON_ID,
  getAppIcon,
  getCustomAppIconBlob,
  renderCustomAppIcon,
  setAppIcon,
  setCustomAppIcon,
} from "@/lib/app-icon";
import { isDesktopRuntime, isMacDesktopRuntime } from "@/lib/desktop";
import { Plus } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function AppIconSetting() {
  const [selected, setSelected] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const showCustom = (blob: Blob) => {
    setCustomUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(blob);
    });
  };

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await getAppIcon();
        if (cancelled) return;
        setSelected(state.selected);
        if (state.hasCustom) {
          const blob = await getCustomAppIconBlob();
          if (!cancelled) showCustom(blob);
        }
      } catch (error) {
        console.error("Could not read the app icon", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (customUrl) URL.revokeObjectURL(customUrl);
    },
    [customUrl],
  );

  const choose = async (id: string) => {
    if (busy || id === selected) return;
    setBusy(true);
    try {
      await setAppIcon(id);
      setSelected(id);
    } catch (error) {
      toast.error(`Could not change the app icon: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const png = await renderCustomAppIcon(file, isMacDesktopRuntime());
      await setCustomAppIcon(png);
      showCustom(png);
      setSelected(CUSTOM_APP_ICON_ID);
    } catch (error) {
      toast.error(`Could not use that image: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (selected === null) return null;

  const tileClass = (active: boolean) =>
    cn(
      "flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border-2 transition-colors disabled:opacity-60",
      active ? "border-primary" : "border-transparent hover:border-border",
    );

  return (
    <SettingRow
      settingId="app-icon"
      title="App Icon"
      description="Changes the icon in the Dock or taskbar while Rexa DB is running."
    >
      <div className="flex items-center gap-1">
        {APP_ICON_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.label}
            aria-label={preset.label}
            aria-pressed={selected === preset.id}
            disabled={busy}
            className={tileClass(selected === preset.id)}
            onClick={() => void choose(preset.id)}
          >
            <img src={`/app-icons/${preset.id}.png`} alt="" className="h-full w-full object-contain" />
          </button>
        ))}
        {customUrl ? (
          <button
            type="button"
            title="Custom"
            aria-label="Custom"
            aria-pressed={selected === CUSTOM_APP_ICON_ID}
            disabled={busy}
            className={tileClass(selected === CUSTOM_APP_ICON_ID)}
            onClick={() => void choose(CUSTOM_APP_ICON_ID)}
          >
            <img src={customUrl} alt="" className="h-full w-full object-contain" />
          </button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="ml-1 h-8 gap-1 px-2.5 text-xs"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Plus className="h-3 w-3" />
          Custom
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </SettingRow>
  );
}
