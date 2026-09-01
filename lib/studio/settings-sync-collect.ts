import {
  getAppFontFamily,
  getGlobalAppThemeSettings,
  getGlobalEditorThemeSettings,
  getGlobalStudioSettings,
  getKeybindingsFile,
  saveAppFontFamily,
  saveGlobalAppThemeSettings,
  saveGlobalEditorThemeSettings,
  saveGlobalStudioSettings,
  saveKeybindingsFile,
} from "@/lib/api/actions-client";
import {
  mergeStudioSettingsPreservingSecrets,
  stripSecretsFromStudioSettings,
} from "@/lib/supabase/settings-sync";
import type { SettingsSyncPayloadV1 } from "@/lib/studio/settings-sync-events";

export async function collectLocalSettingsSyncPayload(): Promise<SettingsSyncPayloadV1> {
  const [studioRes, appThemeRes, editorThemeRes, fontRes, keybindingsRes] =
    await Promise.all([
      getGlobalStudioSettings().catch(() => null),
      getGlobalAppThemeSettings().catch(() => null),
      getGlobalEditorThemeSettings().catch(() => null),
      getAppFontFamily().catch(() => null),
      getKeybindingsFile().catch(() => null),
    ]);

  const payload: SettingsSyncPayloadV1 = { version: 1 };

  if (studioRes?.success && studioRes.data && typeof studioRes.data === "object") {
    payload.studioSettings = stripSecretsFromStudioSettings(
      studioRes.data as Record<string, unknown>,
    );
  }

  if (appThemeRes?.success && appThemeRes.data) {
    payload.appTheme = {
      appThemeId:
        typeof appThemeRes.data.appThemeId === "string"
          ? appThemeRes.data.appThemeId
          : "zinc-dark-white",
      customAppThemes:
        typeof appThemeRes.data.customAppThemes === "string"
          ? appThemeRes.data.customAppThemes
          : "[]",
    };
  }

  if (editorThemeRes?.success && editorThemeRes.data) {
    payload.editorTheme = {
      editorThemeId:
        typeof editorThemeRes.data.editorThemeId === "string"
          ? editorThemeRes.data.editorThemeId
          : "auto",
      customEditorThemes:
        typeof editorThemeRes.data.customEditorThemes === "string"
          ? editorThemeRes.data.customEditorThemes
          : "[]",
    };
  }

  if (fontRes?.success) {
    payload.appFontFamily =
      typeof fontRes.data === "string" ? fontRes.data : null;
  }

  if (keybindingsRes?.success && keybindingsRes.data) {
    payload.keybindings = keybindingsRes.data as Record<string, unknown>;
  }

  return payload;
}

export async function applySettingsSyncPayloadLocally(
  payload: SettingsSyncPayloadV1,
): Promise<void> {
  const writes: Promise<unknown>[] = [];

  if (payload.studioSettings) {
    writes.push(
      (async () => {
        const local = await getGlobalStudioSettings().catch(() => null);
        const localData =
          local?.success && local.data && typeof local.data === "object"
            ? (local.data as Record<string, unknown>)
            : {};
        const merged = mergeStudioSettingsPreservingSecrets(
          payload.studioSettings,
          localData,
        );
        await saveGlobalStudioSettings(merged);
      })(),
    );
  }

  if (payload.appTheme) {
    writes.push(saveGlobalAppThemeSettings(payload.appTheme));
  }

  if (payload.editorTheme) {
    writes.push(saveGlobalEditorThemeSettings(payload.editorTheme));
  }

  if (payload.appFontFamily !== undefined) {
    writes.push(saveAppFontFamily(payload.appFontFamily ?? null));
  }

  if (payload.keybindings && typeof payload.keybindings === "object") {
    writes.push(saveKeybindingsFile(payload.keybindings));
  }

  await Promise.all(writes);
}
