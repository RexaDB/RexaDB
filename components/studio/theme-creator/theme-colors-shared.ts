export function toHex(color: string): string {
  if (!color) return "#888888";
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const r = color[1],
      g = color[2],
      b = color[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = color;
      const hex = ctx.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    }
  } catch {}
  return "#888888";
}

export const COLOR_PRESETS = [
  "#000000",
  "#1a1a1a",
  "#2d2d2d",
  "#3d3d3d",
  "#555555",
  "#777777",
  "#999999",
  "#aaaaaa",
  "#cccccc",
  "#dddddd",
  "#eeeeee",
  "#f5f5f5",
  "#ffffff",
  "#0f172a",
  "#1e293b",
  "#334155",
  "#475569",
  "#64748b",
  "#94a3b8",
  "#cbd5e1",
  "#0a0a0a",
  "#18181b",
  "#27272a",
  "#3f3f46",
  "#52525b",
  "#a1a1aa",
  "#d4d4d8",
  "#020617",
  "#1e3a5f",
  "#1e40af",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#052e16",
  "#14532d",
  "#166534",
  "#22c55e",
  "#4ade80",
  "#86efac",
  "#7c2d12",
  "#9a3412",
  "#ea580c",
  "#f97316",
  "#fb923c",
  "#fdba74",
  "#881337",
  "#9f1239",
  "#e11d48",
  "#f43f5e",
  "#fb7185",
  "#fda4af",
  "#4c1d95",
  "#6d28d9",
  "#8b5cf6",
  "#a78bfa",
  "#c4b5fd",
  "#ddd6fe",
  "#0f766e",
  "#14b8a6",
  "#2dd4bf",
  "#5eead4",
  "#99f6e4",
  "#854d0e",
  "#ca8a04",
  "#eab308",
  "#facc15",
  "#fde047",
];
