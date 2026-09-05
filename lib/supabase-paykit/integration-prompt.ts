import type { PaykitDraftState } from "./types";
import { buildBillingPrompt } from "./billing-prompt";
import { paykitApiUrl, paykitWebhookUrl } from "./types";

/**
 * One combined brief for an AI agent implementing billing against this
 * project: the live catalog (real ids — never placeholders) plus the exact
 * app-integration contract and the rules that must not be broken.
 * Pure function — safe to unit test. Never contains keys or secrets.
 */
export function buildIntegrationPrompt(
  drafts: PaykitDraftState,
  projectRef: string,
): string {
  const api = paykitApiUrl(projectRef);
  const paidPlan =
    drafts.plans.find(
      (p) => !p.default && p.priceAmount != null && Number.isFinite(Number(p.priceAmount)),
    ) ??
    drafts.plans.find((p) => !p.default) ??
    drafts.plans[0];
  const freePlan = drafts.plans.find((p) => p.default);
  const feature = drafts.features[0];

  const planId = paidPlan?.id || "pro";
  const featureId = feature?.id || "messages";

  const lines: string[] = [];
  lines.push(buildBillingPrompt(drafts).trimEnd());
  lines.push("");
  lines.push("## App integration");
  lines.push("");
  lines.push(`Billing API base: \`${api}\``);
  lines.push(`Webhook endpoint (already registered in Stripe): \`${paykitWebhookUrl(projectRef)}\``);
  lines.push("");
  lines.push(
    "Every app call below authenticates with the **signed-in user's Supabase access token** " +
      "(`Authorization: Bearer <user-jwt>`). The anon key and service_role key get 401 — never use them from the app.",
  );
  lines.push("");
  lines.push("### 1. Start checkout (paid plan)");
  lines.push("```js");
  lines.push(`const sub = await fetch("${api}?action=subscribe", {`);
  lines.push(`  method: "POST",`);
  lines.push(`  headers: {`);
  lines.push(`    "Content-Type": "application/json",`);
  lines.push(`    Authorization: "Bearer " + supabaseAccessToken,`);
  lines.push(`  },`);
  lines.push(`  body: JSON.stringify({`);
  lines.push(`    planId: "${planId}",`);
  lines.push(`    successUrl: window.location.origin + "/billing/success",`);
  lines.push(`    cancelUrl: window.location.origin + "/billing",`);
  lines.push(`  }),`);
  lines.push(`}).then((r) => r.json());`);
  lines.push(`if (sub.paymentUrl) window.location.href = sub.paymentUrl;`);
  lines.push("```");
  lines.push("");
  if (freePlan) {
    lines.push(
      `Free/default plan (\`${freePlan.id}\`): the same call returns \`{ active: true }\` with **no \`paymentUrl\`** — ` +
        "do NOT redirect. Only redirect when `paymentUrl` is present.",
    );
    lines.push("");
  }
  lines.push("### 2. Gate a feature (call BEFORE the gated action)");
  lines.push("```js");
  lines.push(`const gate = await fetch("${api}?action=check", {`);
  lines.push(`  method: "POST",`);
  lines.push(`  headers: {`);
  lines.push(`    "Content-Type": "application/json",`);
  lines.push(`    Authorization: "Bearer " + supabaseAccessToken,`);
  lines.push(`  },`);
  lines.push(`  body: JSON.stringify({ featureId: "${featureId}" }),`);
  lines.push(`}).then((r) => r.json());`);
  lines.push(`if (!gate.allowed) throw new Error("Usage limit reached");`);
  lines.push("```");
  lines.push("");
  lines.push("### 3. Report metered usage (call AFTER the action succeeds)");
  lines.push("```js");
  lines.push(`await fetch("${api}?action=report", {`);
  lines.push(`  method: "POST",`);
  lines.push(`  headers: {`);
  lines.push(`    "Content-Type": "application/json",`);
  lines.push(`    Authorization: "Bearer " + supabaseAccessToken,`);
  lines.push(`  },`);
  lines.push(`  body: JSON.stringify({ featureId: "${featureId}", amount: 1 }),`);
  lines.push(`}).then((r) => r.json());`);
  lines.push("```");
  lines.push("");
  lines.push("### 4. Show the user's plan (badges, meters, paywall)");
  lines.push("One call returns everything a paywall or account page needs —");
  lines.push("no subscription-list parsing, no suffix stripping:");
  lines.push("```js");
  lines.push(`const me = await fetch("${api}?action=plan", {`);
  lines.push(`  method: "POST",`);
  lines.push(`  headers: {`);
  lines.push(`    "Content-Type": "application/json",`);
  lines.push(`    Authorization: "Bearer " + supabaseAccessToken,`);
  lines.push(`  },`);
  lines.push(`  body: JSON.stringify({}),`);
  lines.push(`}).then((r) => r.json());`);
  lines.push(`// me = { planId, planName, isDefault, status,`);
  lines.push(`//   entitlements: [{ featureId, type, limit, balance, resetAt }] }`);
  lines.push("```");
  lines.push("");
  lines.push("### Rules — do not break these");
  lines.push(
    "- Always send the signed-in user's access token. Anon/service_role keys return 401.",
  );
  lines.push(
    "- `successUrl` is required for paid plans (400 without it). Free plans never redirect.",
  );
  lines.push(
    "- Use the exact plan/feature ids listed above — never invent ids.",
  );
  lines.push(
    "- Check BEFORE the gated action, report AFTER it succeeds. Reporting on failure drains metered balances for nothing.",
  );
  lines.push(
    "- Non-admin callers can only act as themselves; there is no acting on behalf of other users.",
  );
  lines.push(
    "- Never ask for, store, or embed Stripe secret keys, webhook signing secrets, or Supabase service_role keys in app code.",
  );
  lines.push("");
  return lines.join("\n");
}
