export const DEFAULT_ICON_THEME_ID = "lucide";
export const ICON_THEME_UPDATED_EVENT = "rexadb:icon-theme-updated";

export interface StoredSvgIcon {
  body: string;
  viewBox?: string;
  attrs?: Record<string, string>;
}

export interface CustomIconTheme {
  id: string;
  name: string;
  sourcePath?: string;
  icons: Record<string, StoredSvgIcon>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoredSvgIcon(value: unknown): StoredSvgIcon | null {
  if (!isRecord(value) || typeof value.body !== "string") return null;
  const body = value.body.trim();
  if (!body) return null;

  const attrs: Record<string, string> = {};
  if (isRecord(value.attrs)) {
    for (const [key, attrValue] of Object.entries(value.attrs)) {
      if (typeof attrValue === "string" && attrValue.trim()) {
        attrs[key] = attrValue.trim();
      }
    }
  }

  return {
    body,
    viewBox: typeof value.viewBox === "string" && value.viewBox.trim() ? value.viewBox.trim() : undefined,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
  };
}

export function normalizeCustomIconThemes(value: unknown): CustomIconTheme[] {
  if (!Array.isArray(value)) return [];

  const themes: CustomIconTheme[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || !isRecord(item.icons)) {
      continue;
    }

    const icons: Record<string, StoredSvgIcon> = {};
    for (const [iconName, iconValue] of Object.entries(item.icons)) {
      if (!/^[A-Za-z0-9]+$/.test(iconName)) continue;
      const normalizedIcon = normalizeStoredSvgIcon(iconValue);
      if (normalizedIcon) {
        icons[iconName] = normalizedIcon;
      }
    }

    themes.push({
      id: item.id.trim() || DEFAULT_ICON_THEME_ID,
      name: item.name.trim() || "Custom Icon Theme",
      sourcePath: typeof item.sourcePath === "string" && item.sourcePath.trim() ? item.sourcePath.trim() : undefined,
      icons,
    });
  }

  return themes;
}

