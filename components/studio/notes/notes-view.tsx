"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Type as TextIcon, X } from "@/lib/icon-theme/lucide-react";
import { StudioTooltip } from "@/components/studio/studio-tooltip";
import { NoteWidget } from "./note-widget";
import { newNoteId } from "@/lib/studio/note-utils";
import type { DashboardWidget, DashboardWidgetType, Note } from "@/lib/studio/types";

const NOTE_WIDGET_TYPES: Array<{ value: DashboardWidgetType; label: string }> = [
  { value: "metric", label: "Metric" },
  { value: "table", label: "Table" },
  { value: "bar-chart", label: "Bar chart" },
  { value: "p-chart-1", label: "Bar chart (Grid)" },
  { value: "p-chart-2", label: "Bar chart (Grouped)" },
  { value: "p-chart-3", label: "Bar chart (Striped)" },
  { value: "p-chart-4", label: "Bar chart (Dotted)" },
  { value: "p-chart-12", label: "Bar chart (Horizontal)" },
  { value: "p-chart-19", label: "Bar chart (Metric)" },
  { value: "p-chart-21", label: "Bar chart (Stacked)" },
  { value: "p-chart-20", label: "Dot matrix" },
  { value: "area-chart", label: "Area chart" },
  { value: "p-chart-13", label: "Area chart (Gradient)" },
  { value: "p-chart-14", label: "Area chart (Stacked)" },
  { value: "p-chart-15", label: "Area chart (Step)" },
  { value: "p-chart-17", label: "Line + area (Forecast)" },
  { value: "p-chart-18", label: "Area chart (Crosshatch)" },
  { value: "pie-chart", label: "Pie chart" },
  { value: "sparkline", label: "Sparkline" },
  { value: "progress", label: "Progress" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "gif", label: "GIF" },
];

/** Widget types whose payload lives in `content`, not `query`. */
const CONTENT_WIDGET_TYPES = new Set<DashboardWidgetType>(["text", "image", "gif"]);

function widgetInputPlaceholder(t: DashboardWidgetType): string {
  if (t === "text") return "Static text…";
  if (t === "image" || t === "gif") return "Image URL…";
  return "SELECT …";
}

const mdComponents = {
  h1: (props: any) => <h1 className="mb-2 mt-4 text-xl font-semibold text-foreground" {...props} />,
  h2: (props: any) => <h2 className="mb-2 mt-4 text-lg font-semibold text-foreground" {...props} />,
  h3: (props: any) => <h3 className="mb-1 mt-3 text-base font-semibold text-foreground" {...props} />,
  p: (props: any) => <p className="my-2 text-sm leading-relaxed text-foreground" {...props} />,
  a: (props: any) => <a className="text-indigo-400 underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  ul: (props: any) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-foreground" {...props} />,
  ol: (props: any) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-foreground" {...props} />,
  li: (props: any) => <li className="leading-relaxed" {...props} />,
  code: (props: any) => <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-foreground" {...props} />,
  pre: (props: any) => <pre className="my-2 overflow-auto rounded-md border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed" {...props} />,
  blockquote: (props: any) => <blockquote className="my-2 border-l-2 border-indigo-500 pl-3 text-sm italic text-muted-foreground" {...props} />,
  hr: (props: any) => <hr className="my-4 border-border" {...props} />,
  table: (props: any) => (
    <div className="my-2 overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: any) => <th className="border-b border-border bg-muted px-2 py-1.5 text-left font-medium" {...props} />,
  td: (props: any) => <td className="border-b border-border/50 px-2 py-1.5" {...props} />,
};

type ContentPart =
  | { kind: "md"; text: string; start: number; end: number }
  | { kind: "widget"; id: string; start: number; end: number };

function SlashGlyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-white/[0.06] px-1 font-mono text-[10px] leading-4 text-foreground">
      {children}
    </kbd>
  );
}

interface NoteSlashCommand {
  key: string;
  label: string;
  desc: string;
  glyph: React.ReactNode;
  /** Widget type to create, or "picker" to open the dashboard picker. */
  action: DashboardWidgetType | "picker";
}

const NOTE_SLASH_COMMANDS: NoteSlashCommand[] = [
  { key: "metric", label: "Metric", desc: "Big number from a query", glyph: <SlashGlyph><path d="M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17" /></SlashGlyph>, action: "metric" },
  { key: "table", label: "Table", desc: "Live query results grid", glyph: <SlashGlyph><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></SlashGlyph>, action: "table" },
  { key: "bar", label: "Bar chart", desc: "Label + value bars", glyph: <SlashGlyph><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></SlashGlyph>, action: "bar-chart" },
  { key: "area", label: "Area chart", desc: "Trend over labels", glyph: <SlashGlyph><path d="M2 20 9 12l4 3 7-9" /><path d="M2 20h20" /></SlashGlyph>, action: "area-chart" },
  { key: "pie", label: "Pie chart", desc: "Share of total", glyph: <SlashGlyph><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9h-9z" /></SlashGlyph>, action: "pie-chart" },
  { key: "sparkline", label: "Sparkline", desc: "Tiny trend line", glyph: <SlashGlyph><path d="M2 14l4-6 4 4 5-8 4 4 3-2" /></SlashGlyph>, action: "sparkline" },
  { key: "progress", label: "Progress", desc: "0–100 value bar", glyph: <SlashGlyph><path d="M4 17a8 8 0 0 1 16 0" /><path d="M12 17l4.5-5.5" /></SlashGlyph>, action: "progress" },
  { key: "text", label: "Text", desc: "Static note with {{fields}}", glyph: <SlashGlyph><path d="M5 6V4h14v2M12 4v16M9 20h6" /></SlashGlyph>, action: "text" },
  { key: "image", label: "Image", desc: "Image from a URL", glyph: <SlashGlyph><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5a1.5 1.5 0 0 0-2 0L6 21" /></SlashGlyph>, action: "image" },
  { key: "gif", label: "GIF", desc: "Animated GIF from a URL", glyph: <SlashGlyph><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 15V9h2.5a1.5 1.5 0 0 1 0 3H7m5-3v6m4-6v6m0-6h2.5a1.5 1.5 0 0 1 0 3H16" /></SlashGlyph>, action: "gif" },
  { key: "hbar", label: "Horizontal bars", desc: "Label + value bars, sideways", glyph: <SlashGlyph><path d="M4 6h10M4 12h14M4 18h8M20 20H2" /></SlashGlyph>, action: "p-chart-12" },
  { key: "dots", label: "Dot matrix", desc: "Values as dot grids", glyph: <SlashGlyph><circle cx="6" cy="6" r="1.4" /><circle cx="12" cy="6" r="1.4" /><circle cx="18" cy="6" r="1.4" /><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /><circle cx="6" cy="18" r="1.4" /><circle cx="12" cy="18" r="1.4" /></SlashGlyph>, action: "p-chart-20" },
  { key: "stacked", label: "Stacked bars", desc: "Stacked multi-series bars", glyph: <SlashGlyph><path d="M4 20V12M10 20V7M16 20v-4M22 20H2" /><path d="M4 12V9M10 7V4M16 16v-3" /></SlashGlyph>, action: "p-chart-21" },
  { key: "grouped", label: "Grouped bars", desc: "Side-by-side bar groups", glyph: <SlashGlyph><path d="M5 20v-6M9 20V8M15 20v-6M19 20V8M3 20h18" /></SlashGlyph>, action: "p-chart-2" },
  { key: "gradient", label: "Gradient area", desc: "Area chart with gradient", glyph: <SlashGlyph><path d="M2 20 9 12l4 3 7-9" /><path d="M2 20h20" /></SlashGlyph>, action: "p-chart-13" },
  { key: "step", label: "Step area", desc: "Stepped area trend", glyph: <SlashGlyph><path d="M2 18h6v-6h6V6h6" /><path d="M2 20h20" /></SlashGlyph>, action: "p-chart-15" },
  { key: "forecast", label: "Forecast line", desc: "Line + area forecast", glyph: <SlashGlyph><path d="M2 16 8 10l3 3 6-7" /><path d="M14 6h5v5" /></SlashGlyph>, action: "p-chart-17" },
  { key: "widget", label: "Widget from dashboard", desc: "Clone an existing widget", glyph: <SlashGlyph><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></SlashGlyph>, action: "picker" },
];

/** Detect a `/query` token immediately before the caret (start-of-line or after whitespace). */
function parseSlashToken(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|[\s\n])\/([\w-]*)$/.exec(before);
  if (!m) return null;
  return { start: m.index + m[1].length, query: m[2].toLowerCase() };
}

/** Caret coordinates relative to the textarea's top-left (mirror-div technique). */
function measureCaret(el: HTMLTextAreaElement, pos: number): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(el);
  const div = document.createElement("div");
  const copyProps = [
    "fontFamily", "fontSize", "fontWeight", "letterSpacing",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "lineHeight", "textTransform",
  ];
  for (const prop of copyProps) div.style.setProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), (style as any)[prop]);
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflowWrap = "anywhere";
  div.style.width = `${el.clientWidth}px`;
  div.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  div.appendChild(marker);
  document.body.appendChild(div);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
  const result = { top: marker.offsetTop - el.scrollTop, left: marker.offsetLeft - el.scrollLeft, lineHeight };
  document.body.removeChild(div);
  return result;
}

function splitContent(markdown: string): ContentPart[] {
  const out: ContentPart[] = [];
  if (!markdown) return out;
  const re = /\[\[widget:([A-Za-z0-9_-]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (m.index > last) out.push({ kind: "md", text: markdown.slice(last, m.index), start: last, end: m.index });
    out.push({ kind: "widget", id: m[1], start: m.index, end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  if (last < markdown.length) out.push({ kind: "md", text: markdown.slice(last), start: last, end: markdown.length });
  return out;
}

/** Grow a textarea to fit its content (up to a cap). */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
}

interface NotesViewProps {
  note: Note | null;
  studio: any;
  connectionString: string;
}

type PendingInsert =
  | { kind: "end" }
  | { kind: "at"; offset: number }
  | { kind: "pending"; caret: number }
  | { kind: "composer"; caret: number }
  | { kind: "block"; partIndex: number; caret: number };

/** Hover controls to insert content directly below a widget block. */
function InsertBelowBar({ onText, onWidget }: { onText: () => void; onWidget: () => void }) {
  return (
    <div className="pointer-events-none absolute -top-3 right-2 z-10 flex gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        title="Add text below"
        onClick={onText}
        className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-popover px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground"
      >
        <TextIcon className="size-3" /> Text
      </button>
      <button
        type="button"
        title="Add widget below"
        onClick={onWidget}
        className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-popover px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground"
      >
        <Plus className="size-3" /> Widget
      </button>
    </div>
  );
}

export function NotesView({ note, studio, connectionString }: NotesViewProps) {
  const [refreshKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState<DashboardWidgetType>("metric");
  const [draftQuery, setDraftQuery] = useState("");
  const [newWidgetType, setNewWidgetType] = useState<DashboardWidgetType>("bar-chart");
  const [newWidgetTitle, setNewWidgetTitle] = useState("");
  const [newWidgetQuery, setNewWidgetQuery] = useState("");
  // Single-pane in-place editing: which content part is being edited + its draft.
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [blockDraft, setBlockDraft] = useState("");
  // Bottom composer for appending new markdown.
  const [composer, setComposer] = useState("");
  // Note title draft: edited freely, committed explicitly (⌘↵) — never on
  // every keystroke, so typing doesn't churn the store or rename the tab.
  const [titleDraft, setTitleDraft] = useState(note?.name ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [slashOwner, setSlashOwner] = useState<string | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const blockRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingInsert = useRef<PendingInsert>({ kind: "end" });
  // Pending new block: an empty editor parked at a content offset. Content is
  // left untouched until save, so the editor never inherits neighbor text.
  // `base` is the content snapshot at open time (state, not a ref, so saving
  // never reads refs during render).
  const [pending, setPending] = useState<{ at: number; base: string } | null>(null);
  const [pendingDraft, setPendingDraft] = useState("");
  const pendingRef = useRef<HTMLTextAreaElement>(null);

  const dashboards: any[] = useMemo(() => studio?.dashboards ?? [], [studio?.dashboards]);

  const parts = useMemo(() => splitContent(note?.content ?? ""), [note?.content]);

  const embeddedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of parts) if (p.kind === "widget") ids.add(p.id);
    return ids;
  }, [parts]);

  const trailingWidgets = useMemo(
    () => (note?.widgets ?? []).filter((w) => !embeddedIds.has(w.id)),
    [note?.widgets, embeddedIds],
  );

  const slashRows = useMemo(() => {
    if (!slash) return [];
    const q = slash.query;
    return NOTE_SLASH_COMMANDS.filter(
      (c) => c.key.startsWith(q) || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
    );
  }, [slash]);

  useEffect(() => {
    setSlashActive(0);
  }, [slash?.query]);

  // Reset transient editing state when switching notes.
  const noteId = note?.id;
  useEffect(() => {
    setEditingBlock(null);
    setBlockDraft("");
    setComposer("");
    setSlash(null);
    setSlashOwner(null);
    setPending(null);
    setPendingDraft("");
    setTitleDraft(note?.name ?? "");
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up external renames (e.g. sidebar) while the title isn't focused.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitleDraft(note?.name ?? "");
  }, [note?.name]);

  // If content changes underneath an open pending editor (e.g. a widget is
  // removed elsewhere), the parked offset would be stale — close without
  // saving rather than inserting at the wrong position.
  const noteContent = note?.content ?? "";
  useEffect(() => {
    if (pending && noteContent !== pending.base) {
      setPending(null);
      setPendingDraft("");
      setSlash(null);
      setSlashOwner(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteContent]);

  if (!note) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Note not found.</div>;
  }
  const activeNote: Note = note;

  const widgetById = new Map((activeNote.widgets ?? []).map((w) => [w.id, w]));
  const isTitleDirty = titleDraft !== activeNote.name;

  /** Commit the title draft (⌘↵ or blur). Empty reverts. */
  function commitTitle() {
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(activeNote.name);
      return;
    }
    if (next !== activeNote.name) studio.updateNote(activeNote.id, { name: next });
  }

  function revertTitle() {
    setTitleDraft(activeNote.name);
    titleRef.current?.blur();
  }

  function makeWidget(type: DashboardWidgetType, title: string): DashboardWidget {
    return {
      id: newNoteId(),
      widgetType: type,
      title: title.trim() || "Untitled widget",
      query: "",
      content: "",
      conditions: [],
      x: 0,
      y: 0,
      width: 800,
      height: 320,
    };
  }

  /** Replace a content part's source range with new text. */
  function commitBlock(partIndex: number, text: string) {
    const r = parts[partIndex];
    if (!r) return;
    const content = activeNote.content ?? "";
    const next = content.slice(0, r.start) + text + content.slice(r.end);
    studio.updateNote(activeNote.id, { content: next });
    setEditingBlock(null);
  }

  function startBlockEdit(partIndex: number, text: string) {
    setEditingBlock(partIndex);
    setBlockDraft(text);
    setPending(null);
    setPendingDraft("");
    setSlash(null);
    setSlashOwner(null);
  }

  /** Widgets with no `[[widget:id]]` tag in content render trailing (after
   *  all text), so appended text would land above them. Pin their tags at the
   *  end first, keeping visible order == content order. */
  function pinOrphanWidgets(base: string, extra = ""): string {
    const haystack = `${base}\n${extra}`;
    const missing = (activeNote.widgets ?? []).filter((w) => !haystack.includes(`[[widget:${w.id}]]`));
    if (missing.length === 0) return base;
    const tags = missing.map((w) => `[[widget:${w.id}]]`).join("\n");
    return `${base}${base.endsWith("\n") ? "" : "\n"}${tags}\n`;
  }

  /** Append the composer text to the note and clear it. */
  function appendComposer() {
    if (!composer.trim()) return;
    const base = pinOrphanWidgets(activeNote.content ?? "", composer);
    const sep = !base ? "" : base.endsWith("\n") ? "\n" : "\n\n";
    studio.updateNote(activeNote.id, { content: `${base}${sep}${composer}` });
    setComposer("");
    setSlash(null);
    setSlashOwner(null);
  }

  /** Park an empty new-block editor at a content offset (between-block "+",
   *  "text below" buttons). Content is untouched until save, so the editor
   *  always starts blank instead of inheriting a neighbor block's text. */
  function openPendingAt(offset: number) {
    const base = activeNote.content ?? "";
    setPending({ at: Math.max(0, Math.min(offset, base.length)), base });
    setPendingDraft("");
    setEditingBlock(null);
    setSlash(null);
    setSlashOwner(null);
  }

  /** Between-block "+" buttons. */
  function insertBetween(offset: number) {
    openPendingAt(offset);
  }

  /** "Add text below" on a widget (or end-of-note "+"). */
  function insertTextBelow(offset: number) {
    openPendingAt(offset);
  }

  /** Splice the pending draft into the note at the parked offset. */
  function savePending() {
    if (!pending) return;
    // Heal orphans first (append-only, so the parked offset stays valid).
    // Otherwise the new block could render above an unembedded chart.
    const base = pinOrphanWidgets(pending.base);
    const at = Math.max(0, Math.min(pending.at, base.length));
    const text = pendingDraft.trim();
    setPending(null);
    setPendingDraft("");
    setSlash(null);
    setSlashOwner(null);
    if (!text) return;
    const before = base.slice(0, at);
    const after = base.slice(at);
    const left = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const right = !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    studio.updateNote(activeNote.id, { content: `${before}${left}${text}${right}${after}` });
  }

  function cancelPending() {
    setPending(null);
    setPendingDraft("");
    setSlash(null);
    setSlashOwner(null);
  }

  /** Insert a widget embed token at the pending location (from the picker). */
  function insertEmbed(id: string) {
    const ins = pendingInsert.current;
    const embed = `[[widget:${id}]]\n`;
    if (ins.kind === "at") {
      const base = activeNote.content ?? "";
      const at = Math.max(0, Math.min(ins.offset, base.length));
      studio.updateNote(activeNote.id, { content: `${base.slice(0, at)}\n${embed}${base.slice(at)}` });
      pendingInsert.current = { kind: "end" };
      setPickerOpen(false);
      return;
    }
    if (ins.kind === "composer") {
      const c = Math.max(0, Math.min(ins.caret, composer.length));
      setComposer(`${composer.slice(0, c)}\n${embed}${composer.slice(c)}`);
      pendingInsert.current = { kind: "end" };
      setPickerOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (ins.kind === "pending") {
      const c = Math.max(0, Math.min(ins.caret, pendingDraft.length));
      setPendingDraft(`${pendingDraft.slice(0, c)}\n${embed}${pendingDraft.slice(c)}`);
      pendingInsert.current = { kind: "end" };
      setPickerOpen(false);
      requestAnimationFrame(() => pendingRef.current?.focus());
      return;
    }
    if (ins.kind === "block") {
      const c = Math.max(0, Math.min(ins.caret, blockDraft.length));
      commitBlock(ins.partIndex, `${blockDraft.slice(0, c)}\n${embed}${blockDraft.slice(c)}`);
      pendingInsert.current = { kind: "end" };
      setPickerOpen(false);
      return;
    }
    const base = pinOrphanWidgets(activeNote.content ?? "");
    const sep = !base ? "" : base.endsWith("\n") ? "" : "\n";
    studio.updateNote(activeNote.id, { content: `${base}${sep}${embed}` });
    pendingInsert.current = { kind: "end" };
    setPickerOpen(false);
  }

  function removeWidget(id: string) {
    studio.removeNoteWidget(activeNote.id, id);
    const cleaned = (activeNote.content ?? "")
      .replaceAll(`[[widget:${id}]]`, "")
      .replace(/\n{3,}/g, "\n\n");
    studio.updateNote(activeNote.id, { content: cleaned });
    setEditingBlock(null);
  }

  function stripWidgetToken(id: string) {
    const cleaned = (activeNote.content ?? "")
      .replaceAll(`[[widget:${id}]]`, "")
      .replace(/\n{3,}/g, "\n\n");
    studio.updateNote(activeNote.id, { content: cleaned });
  }

  function handleCloneWidget(source: any) {
    const id = newNoteId();
    const widget: DashboardWidget = {
      id,
      widgetType: source.widgetType ?? "metric",
      title: source.title ?? "Untitled widget",
      query: source.query ?? "",
      tableName: source.tableName,
      schema: source.schema,
      content: source.content ?? "",
      conditions: Array.isArray(source.conditions) ? source.conditions : [],
      x: 0,
      y: 0,
      width: 800,
      height: 320,
    };
    studio.addNoteWidget(activeNote.id, widget);
    setPickerOpen(false);
    insertEmbed(id);
  }

  function handleCreateWidget() {
    const isContent = CONTENT_WIDGET_TYPES.has(newWidgetType);
    const widget: DashboardWidget = {
      id: newNoteId(),
      widgetType: newWidgetType,
      title: newWidgetTitle.trim() || "Untitled widget",
      query: isContent ? "" : newWidgetQuery,
      content: isContent ? newWidgetQuery : "",
      conditions: [],
      x: 0,
      y: 0,
      width: 800,
      height: 320,
    };
    studio.addNoteWidget(activeNote.id, widget);
    setNewWidgetTitle("");
    setNewWidgetQuery("");
    setPickerOpen(false);
    insertEmbed(widget.id);
  }

  function openWidgetEditor(widget: DashboardWidget) {
    setEditingWidgetId(widget.id);
    setDraftTitle(widget.title);
    setDraftType(widget.widgetType);
    setDraftQuery(CONTENT_WIDGET_TYPES.has(widget.widgetType) ? widget.content ?? "" : widget.query ?? "");
  }

  function saveWidgetEditor() {
    if (!editingWidgetId) return;
    const isContent = CONTENT_WIDGET_TYPES.has(draftType);
    studio.updateNoteWidget(activeNote.id, editingWidgetId, {
      title: draftTitle.trim() || "Untitled widget",
      widgetType: draftType,
      ...(isContent ? { content: draftQuery, query: "" } : { query: draftQuery, content: "" }),
    });
    setEditingWidgetId(null);
  }

  /** Recompute the `/` token + menu position for whichever field owns the caret. */
  function refreshSlashFor(owner: string, el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? el.value.length;
    const token = parseSlashToken(el.value, caret);
    setSlash(token);
    setSlashOwner(token ? owner : null);
    if (token) {
      const coords = measureCaret(el, caret);
      setSlashPos({ top: coords.top + coords.lineHeight + 6, left: Math.max(0, coords.left) });
    }
  }

  /** Replace the `/query` token with the picked result, in the owning field. */
  function pickSlashCommand(cmd: NoteSlashCommand) {
    const token = slash;
    const owner = slashOwner;
    if (!token || !owner) return;
    if (owner === "composer") {
      const caret = composerRef.current?.selectionStart ?? composer.length;
      const before = composer.slice(0, token.start);
      const after = composer.slice(caret);
      if (cmd.action === "picker") {
        setComposer(`${before}${after}`);
        pendingInsert.current = { kind: "composer", caret: token.start };
        setSlash(null);
        setSlashOwner(null);
        setPickerOpen(true);
        return;
      }
      const widget = makeWidget(cmd.action, cmd.label);
      studio.addNoteWidget(activeNote.id, widget);
      const embed = `\n[[widget:${widget.id}]]\n`;
      setComposer(`${before}${embed}${after}`);
      setSlash(null);
      setSlashOwner(null);
      const nextCaret = token.start + embed.length;
      requestAnimationFrame(() => {
        const el = composerRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        }
      });
      // Open the visual editor so title/query get configured immediately.
      openWidgetEditor(widget);
      return;
    }
    if (owner === "pending") {
      const caret = pendingRef.current?.selectionStart ?? pendingDraft.length;
      const before = pendingDraft.slice(0, token.start);
      const after = pendingDraft.slice(caret);
      if (cmd.action === "picker") {
        setPendingDraft(`${before}${after}`);
        pendingInsert.current = { kind: "pending", caret: token.start };
        setSlash(null);
        setSlashOwner(null);
        setPickerOpen(true);
        return;
      }
      const widget = makeWidget(cmd.action, cmd.label);
      studio.addNoteWidget(activeNote.id, widget);
      const embed = `\n[[widget:${widget.id}]]\n`;
      setPendingDraft(`${before}${embed}${after}`);
      setSlash(null);
      setSlashOwner(null);
      const nextCaret = token.start + embed.length;
      requestAnimationFrame(() => {
        const el = pendingRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        }
      });
      // Open the visual editor so title/query get configured immediately.
      openWidgetEditor(widget);
      return;
    }
    // Block editor owner: "block-<partIndex>".
    const idx = Number(owner.slice("block-".length));
    const caret = blockRefs.current.get(idx)?.selectionStart ?? blockDraft.length;
    const before = blockDraft.slice(0, token.start);
    const after = blockDraft.slice(caret);
    if (cmd.action === "picker") {
      setBlockDraft(`${before}${after}`);
      pendingInsert.current = { kind: "block", partIndex: idx, caret: token.start };
      setSlash(null);
      setSlashOwner(null);
      setPickerOpen(true);
      return;
    }
    const widget = makeWidget(cmd.action, cmd.label);
    studio.addNoteWidget(activeNote.id, widget);
    const embed = `\n[[widget:${widget.id}]]\n`;
    commitBlock(idx, `${before}${embed}${after}`);
    setSlash(null);
    setSlashOwner(null);
    // Open the visual editor so title/query get configured immediately.
    openWidgetEditor(widget);
  }

  /** Shared keyboard handling for slash navigation in any note field. */
  function handleSlashKey(e: React.KeyboardEvent, onCommit: () => void) {
    if (slash && slashRows.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashActive((cur) => (cur + (e.key === "ArrowDown" ? 1 : slashRows.length - 1)) % slashRows.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlashCommand(slashRows[slashActive] ?? slashRows[0]);
        return true;
      }
    }
    if (e.key === "Escape") {
      if (slash) {
        e.preventDefault();
        setSlash(null);
        setSlashOwner(null);
        return true;
      }
      return false;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onCommit();
      return true;
    }
    return false;
  }

  const editingWidget = editingWidgetId ? widgetById.get(editingWidgetId) ?? null : null;

  /** Visual index where the pending new-block editor belongs. */
  const pendingIdx = pending
    ? (() => {
        const i = parts.findIndex((p) => p.start >= pending.at);
        return i === -1 ? parts.length : i;
      })()
    : -1;

  /** Empty new-block editor parked at the pending offset. Starts blank and
   *  splices into content on save — never edits a neighbor block. */
  function renderPendingEditor() {
    if (!pending) return null;
    return (
      <div className="relative rounded-lg border border-indigo-500/40 bg-white/[0.02] p-2">
        <Textarea
          ref={pendingRef}
          autoFocus
          value={pendingDraft}
          rows={3}
          onChange={(e) => {
            setPendingDraft(e.target.value);
            autoGrow(e.target);
            refreshSlashFor("pending", e.target);
          }}
          onSelect={(e) => refreshSlashFor("pending", e.currentTarget)}
          onKeyDown={(e) => {
            if (handleSlashKey(e, savePending)) return;
            if (e.key === "Escape") cancelPending();
          }}
          onBlur={() => {
            if (slashOwner === "pending") {
              setSlash(null);
              setSlashOwner(null);
            }
          }}
          placeholder="Write a new block…  ( / for widgets )"
          className="min-h-16 resize-none border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0"
        />
        {slash && slashOwner === "pending" && renderSlashMenu()}
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-[11px] text-muted-foreground">⌘↵ adds block · esc cancels</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cancelPending}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={savePending} disabled={!pendingDraft.trim()}>
              Add block
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /** Floating `/` command menu, rendered inside the owning field's container. */
  function renderSlashMenu() {
    return (
      <div
        className="absolute z-20 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        style={{ top: slashPos.top, left: Math.min(slashPos.left, 240) }}
      >
        {slashRows.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-muted-foreground">No matches for “/{slash?.query}”</div>
        ) : (
          <div className="max-h-64 overflow-y-auto p-1">
            {slashRows.map((cmd, i) => (
              <button
                key={cmd.key}
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseEnter={() => setSlashActive(i)}
                onClick={() => pickSlashCommand(cmd)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === slashActive ? "bg-muted" : ""}`}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-white/[0.03] text-muted-foreground">
                  {cmd.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">/{cmd.key}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{cmd.desc}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="border-t border-border px-2.5 py-1 text-[11px] text-muted-foreground">
          ↑↓ navigate · Enter insert · Esc dismiss
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="relative mb-2">
            <StudioTooltip
              label={
                <span className="flex items-center gap-1">
                  <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd>
                  <span>renames</span>
                  <span className="mx-0.5 text-muted-foreground">·</span>
                  <Kbd>esc</Kbd>
                  <span>reverts</span>
                </span>
              }
            >
              <Input
                ref={titleRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                    titleRef.current?.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    revertTitle();
                  }
                }}
                onBlur={commitTitle}
                placeholder="Untitled"
                aria-label="Note title"
                className={`h-10 border-0 bg-transparent px-2 text-xl font-semibold focus-visible:ring-0 ${isTitleDirty ? "pr-44" : ""}`}
              />
            </StudioTooltip>
            {isTitleDirty && (
              <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-muted-foreground">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
                <span>to save</span>
              </span>
            )}
          </div>
          {parts.length === 0 && trailingWidgets.length === 0 && !composer && (
            <p className="py-8 text-center text-sm text-muted-foreground">Empty note — start writing below.</p>
          )}
          {parts.map((part, i) => {
            const inserter = i === 0 ? null : (
              <div className="group relative flex h-2 items-center justify-center">
                <button
                  type="button"
                  title="Add block here"
                  onClick={() => insertBetween(part.start)}
                  className="absolute hidden size-5 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground group-hover:flex"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            );
            if (part.kind === "md") {
              // Whitespace-only gaps carry no visible content — skip them.
              if (!part.text.trim()) return null;
              if (editingBlock === i) {
                const owner = `block-${i}`;
                return (
                  <Fragment key={i}>
                    {pending && pendingIdx === i && renderPendingEditor()}
                    {inserter}
                    <div className="relative rounded-lg border border-border bg-white/[0.02] p-2">
                      <Textarea
                        ref={(ta) => {
                          if (ta) {
                            blockRefs.current.set(i, ta);
                            autoGrow(ta);
                          } else {
                            blockRefs.current.delete(i);
                          }
                        }}
                        autoFocus
                        value={blockDraft}
                        rows={3}
                        onChange={(e) => {
                          setBlockDraft(e.target.value);
                          autoGrow(e.target);
                          refreshSlashFor(owner, e.target);
                        }}
                        onSelect={(e) => refreshSlashFor(owner, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (handleSlashKey(e, () => commitBlock(i, blockDraft))) return;
                        }}
                        onBlur={() => {
                          if (slashOwner === owner) {
                            setSlash(null);
                            setSlashOwner(null);
                          }
                        }}
                        placeholder="Markdown…  ( / for widgets )"
                        className="min-h-16 resize-none border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0"
                      />
                      {slash && slashOwner === owner && renderSlashMenu()}
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span className="text-[11px] text-muted-foreground">⌘↵ saves · esc cancels</span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setEditingBlock(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => commitBlock(i, blockDraft)}>
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Fragment>
                );
              }
              return (
                <Fragment key={i}>
                  {pending && pendingIdx === i && renderPendingEditor()}
                  {inserter}
                  <div
                    onClick={() => startBlockEdit(i, part.text)}
                    title="Click to edit"
                    className="group relative cursor-text rounded-md px-2 py-0.5 hover:bg-white/[0.03]"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {part.text}
                    </ReactMarkdown>
                    <button
                      type="button"
                      title="Delete block"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitBlock(i, "");
                      }}
                      className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </Fragment>
              );
            }
            const widget = widgetById.get(part.id);
            const addBelow = {
              onText: () => insertTextBelow(part.end),
              onWidget: () => {
                pendingInsert.current = { kind: "at", offset: part.end };
                setPickerOpen(true);
              },
            };
            return (
              <Fragment key={part.id}>
                {pending && pendingIdx === i && renderPendingEditor()}
                {inserter}
                {!widget ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    <span>Widget {part.id} was deleted.</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => stripWidgetToken(part.id)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="group relative">
                    <InsertBelowBar {...addBelow} />
                    <NoteWidget
                      key={`${part.id}-${refreshKey}`}
                      widget={widget}
                      connectionString={connectionString}
                      refreshKey={refreshKey}
                      onEdit={() => openWidgetEditor(widget)}
                      onRemove={() => removeWidget(widget.id)}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
          {trailingWidgets.map((w) => (
            <div key={`${w.id}-${refreshKey}`} className="group relative">
              <InsertBelowBar
                onText={() => insertTextBelow((activeNote.content ?? "").length)}
                onWidget={() => {
                  pendingInsert.current = { kind: "at", offset: (activeNote.content ?? "").length };
                  setPickerOpen(true);
                }}
              />
              <NoteWidget
                widget={w}
                connectionString={connectionString}
                refreshKey={refreshKey}
                onEdit={() => openWidgetEditor(w)}
                onRemove={() => removeWidget(w.id)}
              />
            </div>
          ))}
          {(parts.length > 0 || trailingWidgets.length > 0) && (
            <div className="group relative flex h-2 items-center justify-center">
              <button
                type="button"
                title="Add block here"
                onClick={() => insertTextBelow((activeNote.content ?? "").length)}
                className="absolute hidden size-5 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground group-hover:flex"
              >
                <Plus className="size-3" />
              </button>
            </div>
          )}
          {pending && pendingIdx === parts.length && renderPendingEditor()}
          <div className="relative mt-2 rounded-lg border border-dashed border-border p-2 focus-within:border-muted-foreground/40">
            <Textarea
              ref={composerRef}
              value={composer}
              rows={2}
              onChange={(e) => {
                setComposer(e.target.value);
                autoGrow(e.target);
                refreshSlashFor("composer", e.target);
              }}
              onSelect={(e) => refreshSlashFor("composer", e.currentTarget)}
              onKeyDown={(e) => {
                if (handleSlashKey(e, appendComposer)) return;
              }}
              onBlur={() => {
                if (slashOwner === "composer") {
                  setSlash(null);
                  setSlashOwner(null);
                }
              }}
              placeholder="Write markdown…  ( / for widgets )"
              className="resize-none border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0"
            />
            {slash && slashOwner === "composer" && renderSlashMenu()}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[11px] text-muted-foreground">⌘↵ adds block · / for widgets</span>
              <Button size="sm" className="h-6 px-2 text-[11px]" disabled={!composer.trim()} onClick={appendComposer}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          // Dismissing without choosing must not leave a stale positioned
          // insert behind — the next pick would land in the wrong block.
          if (!open) pendingInsert.current = { kind: "end" };
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add widget to note</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New widget</div>
              <div className="flex gap-2">
                <Select value={newWidgetType} onValueChange={(v) => setNewWidgetType(v as DashboardWidgetType)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTE_WIDGET_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={newWidgetTitle} onChange={(e) => setNewWidgetTitle(e.target.value)} placeholder="Widget title" />
              </div>
              <Textarea
                value={newWidgetQuery}
                onChange={(e) => setNewWidgetQuery(e.target.value)}
                placeholder={widgetInputPlaceholder(newWidgetType)}
                className="font-mono text-xs"
                rows={3}
              />
              <Button size="sm" className="self-start" onClick={handleCreateWidget}>
                <Plus className="size-3.5" /> Create + insert
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">From dashboards</div>
              {dashboards.length === 0 && <p className="text-xs text-muted-foreground">No dashboards yet.</p>}
              {dashboards.map((d: any) => (
                <div key={d.id} className="rounded-md border border-border p-2">
                  <div className="mb-1 truncate text-xs font-medium">{d.name}</div>
                  {(d.widgets ?? []).length === 0 && <div className="text-[11px] text-muted-foreground">No widgets</div>}
                  {(d.widgets ?? []).map((w: any) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => handleCloneWidget(w)}
                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-white/5"
                    >
                      <span className="truncate">{w.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{w.widgetType}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
              <X className="size-3.5" /> Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingWidget} onOpenChange={(open) => !open && setEditingWidgetId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit widget</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <div className="flex gap-2">
              <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Title" />
              <Select value={draftType} onValueChange={(v) => setDraftType(v as DashboardWidgetType)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_WIDGET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder={widgetInputPlaceholder(draftType)}
              className="font-mono text-xs"
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditingWidgetId(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveWidgetEditor}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
