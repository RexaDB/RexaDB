import type { DashboardWidget, Note } from "./types";

function normalizeNoteWidgets(widgets: unknown): DashboardWidget[] {
  if (!Array.isArray(widgets)) return [];
  return widgets
    .filter((w: any) => w && typeof w.id === "string")
    .map((w: any, index: number) => ({
      id: String(w.id),
      widgetType: w.widgetType || (w.tableName ? "table" : "metric"),
      title: typeof w.title === "string" && w.title ? w.title : `Widget ${index + 1}`,
      query: typeof w.query === "string" ? w.query : "",
      tableName: typeof w.tableName === "string" ? w.tableName : undefined,
      schema: typeof w.schema === "string" ? w.schema : undefined,
      content: typeof w.content === "string" ? w.content : "",
      conditions: Array.isArray(w.conditions) ? w.conditions : [],
      // Layout is ignored in notes (auto-size) but keep defaults for type compat.
      x: 0,
      y: index * 320,
      width: 800,
      height: 320,
    }));
}

export function normalizeNotes(rawNotes: any[]): Note[] {
  if (!Array.isArray(rawNotes)) return [];
  return rawNotes
    .filter((n: any) => n && (typeof n.id === "string" || typeof n.id === "number"))
    .map((n: any) => ({
      id: String(n.id),
      name: typeof n.name === "string" && n.name ? n.name : "Untitled note",
      content: typeof n.content === "string" ? n.content : "",
      folderId: typeof n.folderId === "string" ? n.folderId : null,
      createdAt: Number.isFinite(n.createdAt) ? Number(n.createdAt) : Date.now(),
      updatedAt: Number.isFinite(n.updatedAt) ? Number(n.updatedAt) : Date.now(),
      widgets: normalizeNoteWidgets(n.widgets),
    }));
}

/** Extract `[[widget:<id>]]` embed ids in order of appearance. */
export function extractNoteWidgetIds(markdown: string): string[] {
  if (!markdown) return [];
  const ids: string[] = [];
  const re = /\[\[widget:([A-Za-z0-9_-]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Generate a short random id for notes / note widgets. */
export function newNoteId(): string {
  return Math.random().toString(36).slice(2, 10);
}
