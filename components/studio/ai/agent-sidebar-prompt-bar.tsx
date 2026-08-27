"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * Agent Sidebar Prompt Bar — adapted from provided PromptBar
 * Tailored for RexaDB's AI sidebar (sidebar shape, not the
 * full Agents window with provider/mode pickers).
 * No external "glimm" dependency: sweep is a lightweight
 * CSS gradient that mimics the rainbow playSweep.
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  clip: <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  layers: <g><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></g>,
  globe: <g><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></g>,
  command: <path d="M8 8h8v8H8z M8 3v3 M16 3v3 M8 18v3 M16 18v3 M3 8h3 M18 8h3 M3 16h3 M18 16h3" />,
  table: <g><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></g>,
};

const BRANDS: Record<string, React.ReactNode> = {
  figma: (
    <svg width="11" height="16" viewBox="0 0 38 57" aria-hidden="true">
      <path d="M9.5 57A9.5 9.5 0 0 0 19 47.5V38H9.5a9.5 9.5 0 0 0 0 19z" fill="#0ACF83" />
      <path d="M0 28.5A9.5 9.5 0 0 1 9.5 19H19v19H9.5A9.5 9.5 0 0 1 0 28.5z" fill="#A259FF" />
      <path d="M0 9.5A9.5 9.5 0 0 1 9.5 0H19v19H9.5A9.5 9.5 0 0 1 0 9.5z" fill="#F24E1E" />
      <path d="M19 0h9.5a9.5 9.5 0 1 1 0 19H19V0z" fill="#FF7262" />
      <path d="M38 28.5a9.5 9.5 0 1 1-19 0 9.5 9.5 0 0 1 19 0z" fill="#1ABCFE" />
    </svg>
  ),
  slack: (
    <svg width="15" height="15" viewBox="0 0 127 127" aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
      <path d="M47 27.2c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.7 39.7.8 47 .8c7.3 0 13.2 5.9 13.2 13.2v13.2H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.3.7 54.4.7 47.1c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
      <path d="M99.9 47.1c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V47.1zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.9C66.9 6.6 72.8.7 80.1.7c7.3 0 13.2 5.9 13.2 13.2v33.2z" fill="#2EB67D" />
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
    </svg>
  ),
  gmail: (
    <svg width="15" height="12" viewBox="0 0 256 193" aria-hidden="true">
      <path d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455h40.727Z" fill="#4285F4" />
      <path d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798v98.91Z" fill="#34A853" />
      <path d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 34.992-4.669 40.644L128 145.504 58.182 93.14Z" fill="#EA4335" />
      <path d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945l-16.292 12.218Z" fill="#FBBC04" />
      <path d="m0 49.504 26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23v23.273Z" fill="#C5221F" />
    </svg>
  ),
};

function ProviderBadge({ provider, size = 12 }: { provider?: string; size?: number }) {
  if (!provider) return null;
  const p = provider.toLowerCase();
  // external / agent
  if (p === "agent" || p === "external") {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-[3px] bg-primary/10 text-primary opacity-100" style={{ width: size, height: size, opacity: 1 }}>
        <Icon size={Math.max(8, size - 2)} strokeWidth={2}><g><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 10h8M8 14h8M12 10v4" /></g></Icon>
      </span>
    );
  }
  const map: Record<string, string> = {
    openai: "/providers/openai.svg",
    anthropic: "/providers/anthropic_black.svg",
    google: "/providers/google.svg",
    openrouter: "/providers/openrouter_light.svg",
    ollama: "/providers/ollama-logo-black-light-svg.svg",
    kilo: "/providers/kilo.svg",
  };
  const src = map[p];
  if (src) {
    return <img src={src} alt={p} width={size} height={size} className={`shrink-0 object-contain opacity-100 ${p !== "google" ? "dark:invert" : ""}`} style={{ width: size, height: size, opacity: 1, filter: p !== "google" ? undefined : "none" }} />;
  }
  // fallback — first letter
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[3px] bg-muted text-[8px] font-bold text-muted-foreground" style={{ width: size, height: size }}>
      {p[0]?.toUpperCase()}
    </span>
  );
}

type Source = {
  key: string;
  name: string;
  desc: string;
  glyph?: string;
  brand?: string;
  attach?: boolean;
  connect?: boolean;
};

const DEFAULT_SOURCES: Source[] = [
  { key: "attach", name: "Add photos & files", desc: "Upload from your computer", glyph: "clip", attach: true },
  { key: "scoop", name: "Scoop Data", desc: "Sales & churn metrics", glyph: "chart" },
  { key: "flavors", name: "Flavor records", desc: "26 makers, tags, links", glyph: "layers" },
  { key: "web", name: "Web search", desc: "Real-time news and info", glyph: "globe" },
  { key: "figma", name: "Figma", desc: "Design-to-code workflows", brand: "figma" },
  { key: "slack", name: "Slack", desc: "Read and manage Slack", brand: "slack" },
  { key: "gmail", name: "Gmail", desc: "Read and manage Gmail", brand: "gmail", connect: true },
];

const DEFAULT_COMMANDS = [
  { key: "compare", name: "/compare", desc: "Compare table schemas" },
  { key: "explain", name: "/explain", desc: "Explain a query plan" },
  { key: "summarize", name: "/summarize", desc: "Summarize this table" },
  { key: "generate", name: "/generate", desc: "Generate SQL for a task" },
  { key: "restock", name: "/restock", desc: "Build a reorder list" },
];

const DEFAULT_MODELS = [
  { key: "sprinkles-5", name: "Sprinkles 5", tag: "Flagship" },
  { key: "vanilla-1", name: "Vanilla 1", tag: "Basic" },
  { key: "freezer-burn", name: "Freezer Burn 0.4", tag: "Stale" },
];

const FILES = ["flavor-chart.png", "summer-menu.pdf", "pos-export.csv"];

const AUTO_STEPS: {
  draft: string;
  active?: number;
  connect?: boolean;
  modelOpen?: boolean;
  model?: string;
  hold: number;
}[] = [
  { draft: "", connect: false, model: "vanilla-1", hold: 1100 },
  { draft: "@", active: 0, hold: 900 },
  { draft: "@", active: 1, hold: 620 },
  { draft: "@", active: 4, hold: 620 },
  { draft: "@", active: 6, hold: 700 },
  { draft: "@", active: 6, connect: true, hold: 1000 },
  { draft: "", hold: 700 },
  { draft: "/", active: 0, hold: 900 },
  { draft: "/", active: 1, hold: 620 },
  { draft: "/", active: 3, hold: 1000 },
  { draft: "", hold: 800 },
  { draft: "", modelOpen: true, hold: 1200 },
  { draft: "", model: "sprinkles-5", hold: 2400 },
  { draft: "", hold: 900 },
];

function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

/* Lightweight sweep fallback (no glimm) */
function useSweep() {
  const [sweeping, setSweeping] = useState(false);
  const trigger = () => {
    if (sweeping) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setSweeping(true);
    setTimeout(() => setSweeping(false), 650);
  };
  return { sweeping, trigger };
}

export type AgentPromptBarModel = { key: string; name: string; tag?: string };

export type AgentSidebarPromptBarProps = {
  variant?: "Rounded" | "Pill";
  demo?: boolean;
  tall?: boolean;
  placeholder?: string;
  onSend?: (text: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  /** Controlled value (used by AiChatSheet). If omitted the bar is self-controlled. */
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Dynamic sources for @ (tables/dashboards). Falls back to defaults if empty. */
  sources?: Source[];
  commands?: Array<{ key: string; name: string; desc: string }>;
  models?: AgentPromptBarModel[];
  selectedModelKey?: string;
  onModelChange?: (model: AgentPromptBarModel) => void;
  onAddModels?: () => void;
  /** For the @ menu, validMentions for highlight parity (unused visually here) */
  validMentions?: Set<string>;
};

export default function AgentSidebarPromptBar({
  variant = "Rounded",
  demo = false,
  tall = false,
  placeholder,
  onSend,
  onStop,
  isStreaming,
  value: controlledValue,
  onChange: controlledOnChange,
  disabled,
  sources: propSources,
  commands: propCommands,
  models: propModels,
  selectedModelKey,
  onModelChange,
  onAddModels,
}: AgentSidebarPromptBarProps) {
  const pill = variant === "Pill";
  const [internalDraft, setInternalDraft] = useState("");
  const isControlled = controlledValue !== undefined;
  const draft = isControlled ? (controlledValue as string) : internalDraft;
  const setDraft = (next: string) => {
    if (isControlled) controlledOnChange?.(next);
    else setInternalDraft(next);
  };

  const SOURCES = propSources && propSources.length > 0 ? propSources : DEFAULT_SOURCES;
  const COMMANDS = propCommands && propCommands.length > 0 ? propCommands : DEFAULT_COMMANDS;
  // When propModels is explicitly provided (even empty) we respect it — this
  // lets the caller point the pill at the *actual* user-configured models
  // instead of the demo DEFAULT_MODELS (sprinkles/vanilla).
  const hasActualModelsProp = propModels !== undefined;
  const MODELS: AgentPromptBarModel[] = hasActualModelsProp ? (propModels as AgentPromptBarModel[]) : DEFAULT_MODELS;

  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const initialModel: AgentPromptBarModel | undefined = MODELS.find((m) => m.key === selectedModelKey) || MODELS[0];
  const fallbackModel: AgentPromptBarModel = { key: "__empty__", name: "Select model", tag: undefined };
  const [internalModel, setInternalModel] = useState<AgentPromptBarModel>(initialModel || fallbackModel);
  // Sync external selection
  useEffect(() => {
    if (selectedModelKey) {
      const found = MODELS.find((m) => m.key === selectedModelKey);
      if (found && found.key !== internalModel.key) setInternalModel(found);
    } else if (MODELS.length > 0 && internalModel.key === "__empty__") {
      setInternalModel(MODELS[0]);
    }
  }, [selectedModelKey, MODELS, internalModel.key]);
  const model: AgentPromptBarModel = selectedModelKey ? (MODELS.find((m) => m.key === selectedModelKey) || internalModel) : internalModel;

  const [attachments, setAttachments] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(demo);
  const [autoStep, setAutoStep] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const wide = expanded || tall;
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [modelBox, setModelBox] = useState<{ top: number; height: number } | null>(null);
  const [modelHovered, setModelHovered] = useState<number | null>(null);
  const [modelMenuLeft, setModelMenuLeft] = useState(0);
  const [modelMenuBottom, setModelMenuBottom] = useState(0);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const modelRowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { sweeping, trigger: triggerSweep } = useSweep();

  const takeOver = (event: { target: EventTarget | null }) => {
    setAuto(false);
    if (auto && event.target === inputRef.current) setDraft("");
  };

  const token = dismissed ? null : parseToken(draft);
  const menu: "at" | "slash" | null = plusOpen ? "at" : token?.kind ?? null;
  const query = plusOpen ? "" : token?.query ?? "";

  const rows: { key: string; name: string; desc: string }[] =
    menu === "at"
      ? SOURCES.filter((s) => s.name.toLowerCase().includes(query) || s.key.toLowerCase().includes(query))
      : menu === "slash"
        ? COMMANDS.filter((c) => c.name.slice(1).startsWith(query) || c.desc.toLowerCase().includes(query))
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) {
      const container = target.closest<HTMLElement>(".overflow-y-auto");
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        setRowBox({ top: targetRect.top - containerRect.top, height: targetRect.height });
      } else {
        setRowBox({ top: target.offsetTop, height: target.offsetHeight });
      }
    }
  }, [menu, query, active, connected, rows.length]);

  // Keep highlight in sync when the @ menu scrolls
  useEffect(() => {
    if (!menu) return;
    const container = document.querySelector<HTMLElement>("[data-promptbar] .overflow-y-auto");
    if (!container) return;
    const onScroll = () => {
      const target = rowRefs.current[active];
      if (!target) return;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setRowBox({ top: targetRect.top - containerRect.top, height: targetRect.height });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [menu, active]);

  const modelIndex = MODELS.findIndex((m) => m.key === model.key);
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const target = modelRowRefs.current[modelHovered ?? modelIndex];
    if (target) {
      const container = target.closest<HTMLElement>(".overflow-y-auto");
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        setModelBox({ top: targetRect.top - containerRect.top, height: targetRect.height });
      } else {
        setModelBox({ top: target.offsetTop, height: target.offsetHeight });
      }
    }
  }, [modelOpen, modelHovered, modelIndex]);

  useEffect(() => {
    if (!modelOpen) return;
    const container = document.querySelector<HTMLElement>("[data-promptbar] .overflow-y-auto");
    // model menu is the second overflow-y-auto when both are open; find the one that contains the hovered row
    const target = modelRowRefs.current[modelHovered ?? modelIndex];
    const modelContainer = target?.closest<HTMLElement>(".overflow-y-auto");
    if (!modelContainer) return;
    const onScroll = () => {
      if (!target) return;
      const containerRect = modelContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setModelBox({ top: targetRect.top - containerRect.top, height: targetRect.height });
    };
    modelContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => modelContainer.removeEventListener("scroll", onScroll);
  }, [modelOpen, modelHovered, modelIndex]);

  useLayoutEffect(() => {
    if (!modelOpen || !composerAnchorRef.current || !modelRef.current) return;
    const anchorRect = composerAnchorRef.current.getBoundingClientRect();
    const triggerRect = modelRef.current.getBoundingClientRect();
    setModelMenuLeft(Math.max(0, Math.min(triggerRect.left - anchorRect.left, anchorRect.width - 176)));
    setModelMenuBottom(anchorRect.bottom - triggerRect.top + 8);
  }, [modelOpen, wide, model.name]);

  useEffect(() => {
    if (!modelOpen) setModelHovered(null);
  }, [modelOpen]);

  const selectModel = (next: AgentPromptBarModel) => {
    if (next.key === "__empty__") return;
    setInternalModel(next);
    onModelChange?.(next);
    setModelOpen(false);
    // Rainbow sweep: demo flagship or any *actual* model selection
    if (next.key === "sprinkles-5" || next.tag === "Flagship" || hasActualModelsProp) triggerSweep();
  };

  useEffect(() => {
    if (!auto) return;
    const step = AUTO_STEPS[autoStep % AUTO_STEPS.length];
    setDraft(step.draft);
    controlledOnChange?.(step.draft);
    if (step.active !== undefined) setActive(step.active);
    if (step.connect !== undefined) setConnected(step.connect);
    if (step.modelOpen !== undefined) setModelOpen(step.modelOpen);
    if (step.model) {
      const next = MODELS.find((m) => m.key === step.model);
      if (next) selectModel(next);
    }
    const t = setTimeout(() => setAutoStep((s) => s + 1), step.hold);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, autoStep]);

  const recomputeExpansion = useCallback(() => {
    const controls = controlsRef.current;
    const measure = measureRef.current;
    const modelButton = modelRef.current;
    if (!controls || !measure || !modelButton) return;

    const fixedControlsWidth = 28 * 2 + modelButton.offsetWidth; // plus + send + model
    const inlineGaps = 4 * 3;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    setExpanded((current) => (current === needsFullWidth ? current : needsFullWidth));
  }, [draft]);

  useLayoutEffect(() => {
    recomputeExpansion();

    const input = inputRef.current;
    if (!input) return;
    const minHeight = 28;
    const maxHeight = 100;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded, placeholder, recomputeExpansion]);

  // The draft-driven effect above only recomputes when the text changes — it
  // misses a panel/sidebar resize that narrows the bar without touching the
  // draft. Watch the controls container directly so dragging the sidebar
  // narrower still pushes the model picker to a second row instead of
  // letting the placeholder/text get clipped.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recomputeExpansion());
    observer.observe(controls);
    return () => observer.disconnect();
  }, [recomputeExpansion]);

  useEffect(() => {
    if (!modelOpen && !plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setModelOpen(false);
        setPlusOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelOpen, plusOpen]);

  const closeMenus = () => {
    setPlusOpen(false);
    setModelOpen(false);
  };

  const pick = (row: { key: string; name: string }) => {
    const source = SOURCES.find((s) => s.key === row.key);
    if (source?.attach) {
      if (fileInputRef.current) fileInputRef.current.click();
      else {
        setAttachments((current) => [...current, FILES[current.length % FILES.length]]);
        if (token) setDraft(draft.slice(0, token.start));
      }
    } else if (menu === "at") {
      const insertion = row.name.includes(".") || row.name.includes("/") ? `@${row.name} ` : `@${row.name} `;
      setDraft(`${token ? draft.slice(0, token.start) : draft}${insertion}`);
    } else {
      setDraft(`${token ? draft.slice(0, token.start) : draft}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !disabled;
  const send = () => {
    if (!canSend) return;
    const text = draft.trim() + (attachments.length ? `\n\n[attached: ${attachments.join(", ")}]` : "");
    onSend?.(text || draft.trim());
    setDraft("");
    setAttachments([]);
    closeMenus();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const names = Array.from(files).map((f) => f.name);
    if (names.length) setAttachments((cur) => [...cur, ...names]);
    if (token) setDraft(draft.slice(0, token.start));
    e.target.value = "";
  };

  return (
    <div
      data-promptbar
      className={demo ? "flex min-h-[384px] w-full max-w-[420px] flex-col justify-end pb-8" : "w-full"}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
    >
      <div ref={composerAnchorRef} className="relative">
      {menu && (
        <div
          onMouseLeave={() => setEngaged(false)}
          className="absolute inset-x-0 bottom-full z-20 mb-2 flex max-h-[260px] flex-col overflow-hidden rounded-[10px] border border-border bg-popover p-1 shadow-lg"
          style={{ animation: "promptbar-pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
        >
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-muted"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {rows.map((row, i) => {
              const source = menu === "at" ? SOURCES.find((s) => s.key === row.key) : undefined;
              return (
                <button
                  key={row.key}
                  type="button"
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setActive(i);
                    setEngaged(true);
                  }}
                  onClick={() => pick(row)}
                  className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-muted/50"
                >
                  {source && (
                    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                      {source.brand ? BRANDS[source.brand] : <Icon size={15}>{GLYPHS[source.glyph ?? "clip"]}</Icon>}
                    </span>
                  )}
                  <span className="shrink-0 text-[12.5px] font-medium text-foreground">{row.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{row.desc}</span>
                  {source?.connect && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConnected((current) => !current);
                      }}
                      className={`shrink-0 text-[12px] font-medium transition-colors duration-100 ${connected ? "text-emerald-600" : "text-primary hover:underline"}`}
                    >
                      {connected ? "Connected" : "Connect"}
                    </span>
                  )}
                </button>
              );
            })}
            {rows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-muted-foreground">No matches for “{query}”</div>
            )}
          </div>
          <div className="mt-1 shrink-0 border-t border-border px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
            {menu === "at" ? "Type to search sources & files" : "Type to search commands"}
          </div>
        </div>
      )}

      {modelOpen && (
        <div
          onMouseLeave={() => setModelHovered(null)}
          className="absolute z-20 w-44 rounded-[10px] border border-border bg-popover p-1 shadow-lg max-h-[260px] overflow-y-auto overscroll-contain"
          style={{ left: modelMenuLeft, bottom: modelMenuBottom, animation: "promptbar-pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom left" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-muted"
            style={{
              top: modelBox?.top ?? 0,
              height: modelBox?.height ?? 0,
              opacity: modelBox && modelHovered !== null ? 1 : 0,
              transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />
          {MODELS.length === 0 ? (
            <div className="px-2 py-6 text-center">
              <div className="text-[12px] font-medium text-foreground">No models configured</div>
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">Add an API key in AI Settings to enable the agent.</div>
            </div>
          ) : (
            MODELS.map((m, i) => (
              <button
                key={m.key}
                type="button"
                ref={(el) => {
                  modelRowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setModelHovered(i)}
                onClick={() => {
                  selectModel(m);
                  inputRef.current?.focus();
                }}
                className="relative z-10 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left"
              >
                <ProviderBadge provider={m.tag} size={14} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{m.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{m.tag}</span>
                <span className={`shrink-0 text-foreground ${m.key === model.key ? "" : "invisible"}`}>
                  <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
                </span>
              </button>
            ))
          )}
          {onAddModels && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setModelOpen(false); onAddModels(); }}
                className="relative z-10 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] text-muted-foreground hover:bg-muted"
              >
                <Icon size={13}><path d="M12 5v14M5 12h14" /></Icon>
                AI Settings…
              </button>
            </>
          )}
        </div>
      )}

      <div
        className={`relative isolate flex flex-col overflow-hidden border border-border/80 bg-card shadow-sm transition-[border-color,border-radius] duration-150 focus-within:border-[#D4D4D4] dark:focus-within:border-[#333333] focus-within:shadow-none ${
          tall ? "gap-2.5 p-3.5" : "gap-1.5 p-1.5"
        } ${pill ? (attachments.length > 0 || wide ? "rounded-[24px]" : "rounded-full") : tall ? "rounded-[22px]" : "rounded-[14px]"}`}
      >
        {/* rainbow sweep fallback */}
        {sweeping && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-0 h-full w-full opacity-60"
            style={{
              borderRadius: "inherit",
              background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7)",
              animation: "promptbar-sweep 650ms cubic-bezier(0.23,1,0.32,1) forwards",
            }}
          />
        )}
        <div className="pointer-events-none absolute inset-0 -z-10 h-full w-full" style={{ borderRadius: "inherit" }} aria-hidden />
        <span ref={measureRef} aria-hidden="true" className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]">{draft || placeholder || "Write a message..."}</span>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} tabIndex={-1} />

        {attachments.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            {attachments.map((file, i) => (
              <span
                key={`${file}-${i}`}
                className={`flex h-6 items-center gap-1.5 bg-muted py-1 pr-1 pl-1.5 text-[11.5px] text-muted-foreground shadow-sm border border-border ${pill ? "rounded-full" : "rounded-md"}`}
                style={{ animation: "promptbar-pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
              >
                <Icon size={12}><g><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g></Icon>
                <span className="max-w-36 truncate">{file}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file}`}
                  onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}
                  className={`-my-1 flex size-6 items-center justify-center text-muted-foreground transition-colors duration-100 hover:bg-border hover:text-foreground ${pill ? "rounded-full" : "rounded-[5px]"}`}
                >
                  <Icon size={10} strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12" /></Icon>
                </button>
              </span>
            ))}
          </div>
        )}

        <div ref={controlsRef} className={`grid gap-x-1 gap-y-1.5 ${wide ? "items-end grid-cols-[28px_auto_minmax(0,1fr)_28px]" : "items-center grid-cols-[28px_minmax(0,1fr)_auto_28px]"}`}>
          <button
            type="button"
            aria-label="Add attachments and sources"
            aria-expanded={plusOpen}
            disabled={disabled}
            onClick={() => {
              setModelOpen(false);
              setPlusOpen((current) => !current);
              inputRef.current?.focus();
            }}
            className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.94] disabled:opacity-40 ${pill ? "rounded-full" : "rounded-[8px]"} ${plusOpen ? "bg-muted text-foreground" : ""} ${wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
          >
            <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setDismissed(false);
              setPlusOpen(false);
            }}
            onKeyDown={(event) => {
              if (menu && rows.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEngaged(true);
                  setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  pick(rows[active]);
                  return;
                }
              }
              if (event.key === "Escape") {
                setDismissed(true);
                closeMenus();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder ?? "Write a message..."}
            aria-label="Prompt"
            className={`${tall ? "min-h-[68px] px-2 py-2 text-[14px] leading-5" : "min-h-7 px-1 py-[5px] text-[13px] leading-[18px]"} min-w-0 w-full resize-none bg-transparent outline-none [overflow-wrap:anywhere] disabled:opacity-60 ${wide ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1 self-center"} ${draft ? "text-foreground" : "text-foreground"} placeholder:text-muted-foreground/60 placeholder:font-normal`}
          />

          <button
            ref={modelRef}
            type="button"
            aria-expanded={modelOpen}
            aria-label="Choose model"
            disabled={disabled}
            onClick={() => {
              setPlusOpen(false);
              setModelOpen((current) => !current);
            }}
            className={`flex h-7 shrink-0 items-center gap-1.5 px-2 text-[12px] font-medium transition-colors duration-150 disabled:opacity-40 ${pill ? "rounded-full" : "rounded-[8px]"} ${wide ? "col-start-2 row-start-2 justify-self-start" : "col-start-3 row-start-1 self-center"} ${model.key === "__empty__" ? "text-muted-foreground/70" : "text-foreground hover:bg-muted"}`}
          >
            <ProviderBadge provider={model.tag} size={14} />
            <span className={model.key === "__empty__" ? "text-muted-foreground/70" : "text-foreground"}>{model.name}</span>
            <span className="text-muted-foreground/60">
              <Icon size={11} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></Icon>
            </span>
          </button>

          {isStreaming ? (
            <button
              type="button"
              aria-label="Stop generation"
              onClick={onStop}
              className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-[background-color,color,transform] duration-200 hover:bg-destructive/90 active:scale-[0.94] ${wide ? "col-start-4 row-start-2" : "col-start-4 row-start-1 self-center"} ${pill ? "rounded-full" : "rounded-[8px]"}`}
            >
              <span className="size-3 rounded-[1px] bg-current" style={{ width: 10, height: 10 }} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!canSend}
              onClick={send}
              className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] disabled:opacity-40 ${pill ? "rounded-full" : "rounded-[8px]"} ${wide ? "col-start-4 row-start-2" : "col-start-4 row-start-1 self-center"}`}
              style={{ backgroundColor: canSend ? "var(--foreground)" : "var(--border)", color: canSend ? "var(--background)" : "var(--muted-foreground)" }}
            >
              <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
            </button>
          )}
        </div>
      </div>
      </div>
      <style>{`@keyframes promptbar-pop-in { from { opacity:0; transform: translateY(4px) scale(0.98)} to {opacity:1; transform: translateY(0) scale(1)} } @keyframes promptbar-sweep { 0%{ transform: translateX(-100%); opacity:0} 20%{opacity:0.7} 100%{ transform: translateX(100%); opacity:0} }`}</style>
    </div>
  );
}
