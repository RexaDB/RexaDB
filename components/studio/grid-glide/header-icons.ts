import type { SpriteMap, Sprite } from "@glideapps/glide-data-grid";

/**
 * Glide's public `DataEditor` component doesn't type `headerIcons` on its
 * props (it's only declared on the internal, non-exported `DataGrid`
 * component) — but the runtime prop plumbing already threads it all the
 * way through (`data-editor/data-editor.js` destructures `headerIcons`
 * straight off props and passes it to `DataGridSearch` unchanged), so no
 * patch to the library is needed, just a local type bridge (see
 * `data-editor-with-header-icons.tsx`).
 *
 * Each sprite is the *exact* SVG path data from the installed
 * `lucide-react` package (node_modules/lucide-react/dist/esm/icons/*.js)
 * for the icons `grid/grid-header.tsx` uses — not an approximation —
 * rendered through Glide's own `SpriteManager` (which rasterizes an SVG
 * string via `data:image/svg+xml` and caches it per color/size).
 */

const LUCIDE_ATTRS = 'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function svg(inner: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${LUCIDE_ATTRS} stroke="${color}">${inner}</svg>`;
}

// lucide "type"
const TYPE_INNER = '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>';
// lucide "hash"
const HASH_INNER =
  '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>';
// lucide "calendar"
const CALENDAR_INNER =
  '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>';
// lucide "check-square" (aliases square-check-big)
const CHECK_SQUARE_INNER =
  '<path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344"/><path d="m9 11 3 3L22 4"/>';
// lucide "database"
const DATABASE_INNER =
  '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>';
// lucide "list"
const LIST_INNER =
  '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>';
// lucide "key"
const KEY_INNER =
  '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>';
// lucide "link"
const LINK_INNER =
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
// lucide "arrow-up"
const ARROW_UP_INNER = '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>';
// lucide "arrow-down"
const ARROW_DOWN_INNER = '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>';
// lucide "plus"
const PLUS_INNER = '<path d="M5 12h14"/><path d="M12 5v14"/>';

export const HEADER_ICON_KEYS = {
  typeText: "rexaTypeText",
  typeNumber: "rexaTypeNumber",
  typeDate: "rexaTypeDate",
  typeBoolean: "rexaTypeBoolean",
  typeUuid: "rexaTypeUuid",
  typeJson: "rexaTypeJson",
  primaryKey: "rexaPrimaryKey",
  foreignKey: "rexaForeignKey",
  sortAsc: "rexaSortAsc",
  sortDesc: "rexaSortDesc",
  addColumn: "rexaAddColumn",
} as const;

// Matches grid/grid-header.tsx exactly: type icons use the header's
// muted foreground (theme-provided fgColor), PK/FK/sort icons use fixed
// Tailwind colors (amber-500 / blue-400 / blue-500) regardless of theme.
const typeSprite = (inner: string): Sprite => ({ fgColor }) => svg(inner, fgColor);
const fixedColorSprite = (inner: string, color: string): Sprite => () => svg(inner, color);

export const REXA_HEADER_ICONS: SpriteMap = {
  [HEADER_ICON_KEYS.typeText]: typeSprite(TYPE_INNER),
  [HEADER_ICON_KEYS.typeNumber]: typeSprite(HASH_INNER),
  [HEADER_ICON_KEYS.typeDate]: typeSprite(CALENDAR_INNER),
  [HEADER_ICON_KEYS.typeBoolean]: typeSprite(CHECK_SQUARE_INNER),
  [HEADER_ICON_KEYS.typeUuid]: typeSprite(DATABASE_INNER),
  [HEADER_ICON_KEYS.typeJson]: typeSprite(LIST_INNER),
  [HEADER_ICON_KEYS.primaryKey]: fixedColorSprite(KEY_INNER, "#f59e0b"),
  [HEADER_ICON_KEYS.foreignKey]: fixedColorSprite(LINK_INNER, "#60a5fa"),
  [HEADER_ICON_KEYS.sortAsc]: fixedColorSprite(ARROW_UP_INNER, "#3b82f6"),
  [HEADER_ICON_KEYS.sortDesc]: fixedColorSprite(ARROW_DOWN_INNER, "#3b82f6"),
  [HEADER_ICON_KEYS.addColumn]: typeSprite(PLUS_INNER),
};

/** Ports `getTypeIcon`'s type-sniffing from grid/grid-header.tsx onto the sprite keys above. */
export function typeIconKey(dataType: string): string {
  const t = dataType.toLowerCase();
  if (t.includes("int") || t.includes("float") || t.includes("decimal") || t.includes("numeric")) {
    return HEADER_ICON_KEYS.typeNumber;
  }
  if (t.includes("date") || t.includes("time")) return HEADER_ICON_KEYS.typeDate;
  if (t.includes("bool")) return HEADER_ICON_KEYS.typeBoolean;
  if (t.includes("uuid")) return HEADER_ICON_KEYS.typeUuid;
  if (t.includes("json")) return HEADER_ICON_KEYS.typeJson;
  return HEADER_ICON_KEYS.typeText;
}
