"use client";

import { useEffect, useState } from "react";

import { readInitialAppearance } from "@/lib/studio/general-utils";
import { getAppFontFamily, saveAppFontFamily } from "@/lib/api/actions-client";
import {
  emitSettingsSyncLocalChanged,
  subscribeSettingsSyncApplied,
} from "@/lib/studio/settings-sync-events";

import { useAppFontFamily } from "./use-app-font-family";

function readInitialFontFamily() {
  const parsed = readInitialAppearance();
  return typeof parsed?.customFontFamily === "string" ? parsed.customFontFamily : "";
}

export function useGlobalAppFontFamily(persist = false) {
  const [customFontFamily, setCustomFontFamily] = useState(readInitialFontFamily);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const load = async () => {
      const result = await getAppFontFamily();
      if (cancelled) return;
      setCustomFontFamily(result.success && typeof result.data === "string" ? result.data : "");
      setIsLoaded(true);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useAppFontFamily(customFontFamily, isLoaded);

  useEffect(() => {
    return subscribeSettingsSyncApplied((detail) => {
      if (detail.payload.appFontFamily === undefined) return;
      setCustomFontFamily(
        typeof detail.payload.appFontFamily === "string"
          ? detail.payload.appFontFamily
          : "",
      );
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!persist || !isLoaded) return;
    void saveAppFontFamily(customFontFamily).then(() => {
      emitSettingsSyncLocalChanged("appFontFamily");
    });
  }, [customFontFamily, isLoaded, persist]);

  return { customFontFamily, setCustomFontFamily, isLoaded };
}
