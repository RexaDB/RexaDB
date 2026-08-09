import { useEffect } from "react";

export function useAppFontFamily(customFontFamily: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const nextValue = customFontFamily.trim();

    if (!nextValue) {
      root.style.removeProperty("--app-font-sans");
      root.removeAttribute("data-custom-font");
      return;
    }

    root.style.setProperty("--app-font-sans", nextValue);
    root.dataset.customFont = "true";

    return () => {
      root.style.removeProperty("--app-font-sans");
      root.removeAttribute("data-custom-font");
    };
  }, [customFontFamily]);
}
