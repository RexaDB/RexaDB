import type { AdvisorResult, AdvisorCheck, AdvisorCategorySummary, AdvisorCategory } from "./types";

export function computeCategorySummary(
  category: AdvisorCategory,
  results: AdvisorResult[],
): AdvisorCategorySummary {
  const filtered = results.filter((r) => r.check.category === category);
  return {
    category,
    label: category.charAt(0).toUpperCase() + category.slice(1),
    icon: category === "performance" ? "Zap" : category === "security" ? "Shield" : "Database",
    total: filtered.length,
    passed: filtered.filter((r) => r.passed).length,
    warnings: filtered.filter((r) => !r.passed && r.check.severity === "warning").length,
    critical: filtered.filter((r) => !r.passed && r.check.severity === "critical").length,
    info: filtered.filter((r) => !r.passed && r.check.severity === "info").length,
  };
}

export const severityColor = (severity: string) => {
  switch (severity) {
    case "critical": return "text-red-500 bg-red-500/10 border-red-500/20";
    case "warning": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    case "info": return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    default: return "text-muted-foreground bg-muted/50";
  }
};

export const severityBadge = (severity: string): "destructive" | "secondary" | "outline" => {
  switch (severity) {
    case "critical": return "destructive";
    case "warning": return "secondary";
    case "info": return "secondary";
    default: return "outline";
  }
};
