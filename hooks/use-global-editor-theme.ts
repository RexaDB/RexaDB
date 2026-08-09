"use client";

import { useEffect, useState } from "react";

import { readInitialAppearance } from "@/lib/studio/general-utils";
import { getGlobalEditorThemeSettings, saveGlobalEditorThemeSettings } from "@/lib/api/actions-client";
import { type CustomEditorTheme } from "@/lib/studio/editor-themes";

function readInitialEditorAppearance() {
  const parsed = readInitialAppearance();
  return {
    editorThemeId: typeof parsed?.editorThemeId === "string" ? parsed.editorThemeId : "auto",
    customEditorThemes: Array.isArray(parsed?.customEditorThemes) ? parsed.customEditorThemes as CustomEditorTheme[] : [],
  };
}

export function useGlobalEditorTheme(persist = false) {
  const [editorThemeId, setEditorThemeId] = useState<string>(() => readInitialEditorAppearance().editorThemeId);
  const [customEditorThemes, setCustomEditorThemes] = useState<CustomEditorTheme[]>(() => readInitialEditorAppearance().customEditorThemes);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") return;
    let cancelled = false;

    const load = async () => {
      const result = await getGlobalEditorThemeSettings();
      if (cancelled) return;
      const nextThemeId = result.success && typeof result.data?.editorThemeId === "string"
        ? result.data.editorThemeId || "auto"
        : "auto";
      let nextCustomThemes: CustomEditorTheme[] = [];
      if (result.success && typeof result.data?.customEditorThemes === "string") {
        try {
          const parsed = JSON.parse(result.data.customEditorThemes);
          if (Array.isArray(parsed)) {
            nextCustomThemes = parsed.filter((theme) =>
              theme &&
              typeof theme.id === "string" &&
              typeof theme.name === "string" &&
              typeof theme.themeJson === "string"
            );
          }
        } catch {
          nextCustomThemes = [];
        }
      }
      setEditorThemeId(nextThemeId);
      setCustomEditorThemes(nextCustomThemes);
      setIsLoaded(true);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persist || !isLoaded) return;
    void saveGlobalEditorThemeSettings({
      editorThemeId,
      customEditorThemes: JSON.stringify(customEditorThemes),
    });
  }, [editorThemeId, customEditorThemes, isLoaded, persist]);

  return {
    editorThemeId,
    setEditorThemeId,
    customEditorThemes,
    setCustomEditorThemes,
    isLoaded,
  };
}
