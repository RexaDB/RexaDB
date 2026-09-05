import type { PaykitDraftState } from "./types";
import { currencySymbol } from "./currencies";

/**
 * Builds a Markdown brief of the local billing drafts, meant to be pasted
 * into an AI assistant (ChatGPT, Claude, OpenCode) for review and help.
 * Pure function — safe to unit test.
 */
export function buildBillingPrompt(drafts: PaykitDraftState): string {
  const lines: string[] = [];
  lines.push("# Billing setup (RexaDB PayKit drafts)");
  lines.push("");
  lines.push(
    "Help me review and improve this Stripe billing setup. " +
      "Products sync to Stripe as products/prices; features sync as entitlement features attached to products.",
  );
  lines.push("");
  lines.push("## Products");
  if (drafts.plans.length === 0) {
    lines.push("- (none yet)");
  }
  for (const p of drafts.plans) {
    const price =
      p.priceAmount == null || Number.isNaN(Number(p.priceAmount))
        ? "Free"
        : `${currencySymbol(p.priceCurrency)}${Number(p.priceAmount).toFixed(2)} ${String(
            p.priceCurrency || "usd",
          ).toUpperCase()} per ${p.priceInterval === "year" ? "year" : "month"}`;
    const feats =
      p.includes
        .map((inc) =>
          inc.limit != null
            ? `${inc.featureId} (limit ${inc.limit}/${inc.reset ?? "month"})`
            : inc.featureId,
        )
        .join(", ") || "no features";
    lines.push(
      `- **${p.name || p.id || "Untitled"}** (\`${p.id || "no-id"}\`) — ${price}, group \`${p.group || "base"}\`${p.default ? ", default" : ""}. Features: ${feats}.`,
    );
  }
  lines.push("");
  lines.push("## Features");
  if (drafts.features.length === 0) {
    lines.push("- (none yet)");
  }
  for (const f of drafts.features) {
    lines.push(
      `- \`${f.id}\` (${f.type})${f.description?.trim() ? ` — ${f.description.trim()}` : ""}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
