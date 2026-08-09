import type { AgentWorkflowPlan } from "@/lib/ai/types";

export function extractCodeBlock(source: string, language: string) {
  const pattern = new RegExp(`\\\`\\\`\\\`${language}\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\``, "i");
  const match = String(source || "").match(pattern);
  return match?.[1]?.trim() || null;
}

export function parseDashboardBlock(source: string) {
  const block = extractCodeBlock(source, "dashboard");
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

export type ParsedThemeBlock =
  | { type: "app"; autoApply?: boolean; theme: { id: string; name: string; base: "light" | "dark"; colors?: Record<string, string> } }
  | { type: "editor"; autoApply?: boolean; theme: { id: string; name: string; themeJson?: string } };

export function parseThemeBlock(source: string): ParsedThemeBlock | null {
  const block = extractCodeBlock(source, "theme");
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type !== "app" && parsed.type !== "editor") return null;
    if (!parsed.theme || typeof parsed.theme !== "object") return null;
    if (typeof parsed.theme.id !== "string" || !parsed.theme.id.trim()) return null;
    if (typeof parsed.theme.name !== "string" || !parsed.theme.name.trim()) return null;
    if (parsed.type === "app") {
      if (parsed.theme.base !== "light" && parsed.theme.base !== "dark") return null;
    }
    return parsed as ParsedThemeBlock;
  } catch {
    return null;
  }
}

export function parseWorkflowBlock(source: string): AgentWorkflowPlan | null {
  const block = extractCodeBlock(source, "workflow");
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    if (!parsed.nodes.every((node: any) => node && typeof node === "object" && typeof node.type === "string")) return null;
    return parsed as AgentWorkflowPlan;
  } catch {
    return null;
  }
}
