export const GLOBAL_AI_SETTINGS_UPDATED_EVENT = "studio:ai-settings-updated";

export function emitGlobalAiSettingsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GLOBAL_AI_SETTINGS_UPDATED_EVENT));
}

export function subscribeGlobalAiSettingsUpdated(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  const listener = () => {
    handler();
  };
  window.addEventListener(GLOBAL_AI_SETTINGS_UPDATED_EVENT, listener);
  return () => {
    window.removeEventListener(GLOBAL_AI_SETTINGS_UPDATED_EVENT, listener);
  };
}
