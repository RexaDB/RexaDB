"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import {
  PAYKIT_WEBHOOK_EVENTS,
  paykitApiUrl,
  paykitWebhookUrl,
} from "@/lib/supabase-paykit/types";

interface GuideTabProps {
  projectRef: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function integrationSnippet(projectRef: string): string {
  const api = paykitApiUrl(projectRef);
  return [
    `// 1. Start checkout (authed user, returns a Stripe payment URL)`,
    `const sub = await fetch("${api}?action=subscribe", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    "Content-Type": "application/json",`,
    `    Authorization: "Bearer " + supabaseAccessToken,`,
    `  },`,
    `  body: JSON.stringify({`,
    `    planId: "pro",`,
    `    successUrl: window.location.origin + "/billing/success",`,
    `    cancelUrl: window.location.origin + "/billing",`,
    `  }),`,
    `}).then((r) => r.json());`,
    `if (sub.paymentUrl) window.location.href = sub.paymentUrl;`,
    ``,
    `// 2. Gate a feature (boolean or metered)`,
    `const gate = await fetch("${api}?action=check", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    "Content-Type": "application/json",`,
    `    Authorization: "Bearer " + supabaseAccessToken,`,
    `  },`,
    `  body: JSON.stringify({ featureId: "messages" }),`,
    `}).then((r) => r.json());`,
    `if (!gate.allowed) throw new Error("Usage limit reached");`,
    ``,
    `// 3. Report metered usage after the action succeeds`,
    `await fetch("${api}?action=report", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    "Content-Type": "application/json",`,
    `    Authorization: "Bearer " + supabaseAccessToken,`,
    `  },`,
    `  body: JSON.stringify({ featureId: "messages", amount: 1 }),`,
    `}).then((r) => r.json());`,
  ].join("\n");
}

export function GuideTab({ projectRef }: GuideTabProps) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(() => integrationSnippet(projectRef), [projectRef]);
  const webhookUrl = paykitWebhookUrl(projectRef);

  const steps: Array<{ title: string; body: string }> = [
    {
      title: "1. Push schema",
      body: "Deploy tab → Push schema, then Expose paykit schema. Creates the private paykit.* tables (service_role only). Safe to re-run.",
    },
    {
      title: "2. Deploy functions",
      body: "Deploy tab → Deploy functions. paykit-webhook ships with --no-verify-jwt (Stripe can't send a Supabase JWT); paykit-api keeps JWT verification on.",
    },
    {
      title: "3. Set secrets",
      body: "Deploy tab → paste STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Values go to Supabase secrets only.",
    },
    {
      title: "4. Register the webhook in Stripe",
      body: `Stripe Dashboard → Developers → Webhooks → Add endpoint → ${webhookUrl}. Select ${PAYKIT_WEBHOOK_EVENTS.join(", ")}. Copy the signing secret back into STRIPE_WEBHOOK_SECRET.`,
    },
    {
      title: "5. Sync products",
      body: "After deploying, call the API action sync-products once (or POST ?action=sync-products with your access token) to create Stripe products/prices and fill paykit_product rows.",
    },
    {
      title: "6. Test",
      body: "Use a Stripe test clock or test card, complete checkout, then check the Webhooks tab (event should be processed) and the Subscriptions tab.",
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => (
        <div
          key={s.title}
          className="rounded-xl border border-studio-border/60 bg-studio-bg/40 p-2.5"
        >
          <p className="text-xs font-medium">{s.title}</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
            {s.body}
          </p>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-medium">App integration</p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[11px]"
          onClick={() => {
            void copyText(snippet).then((ok) => {
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            });
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-xl border border-studio-border/60 bg-black/30 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
        {snippet}
      </pre>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        paykit-api actions: status, upsert-customer, subscribe, check, report,
        sync-products, list-customers, list-subscriptions. Docs: paykit.sh/docs.
      </p>
    </div>
  );
}
