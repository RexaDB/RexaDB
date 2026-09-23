"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { currencySymbol } from "@/lib/supabase-paykit/currencies";
import type { PaykitPlanDraft } from "@/lib/supabase-paykit/types";

export function isPaidPlan(plan: PaykitPlanDraft): boolean {
  return (
    plan.priceAmount !== null &&
    plan.priceAmount !== undefined &&
    Number.isFinite(Number(plan.priceAmount))
  );
}

/** Stripe-style price split: "$29.00 USD" + "Per month", or "Free". */
export function formatPlanPrice(plan: PaykitPlanDraft): {
  main: string;
  sub: string | null;
} {
  if (!isPaidPlan(plan)) return { main: "Free", sub: null };
  const code = (plan.priceCurrency || "usd").toUpperCase();
  return {
    main: `${currencySymbol(plan.priceCurrency)}${Number(plan.priceAmount).toFixed(2)} ${code}`,
    sub: plan.priceInterval === "year" ? "Per year" : "Per month",
  };
}

/** Single-line price label used in containing-product rows. */
export function planPriceLabel(plan: PaykitPlanDraft): string {
  const price = formatPlanPrice(plan);
  if (!price.sub) return price.main;
  return `${price.main} · ${price.sub}`;
}

export function useCopyId(value: string): [boolean, () => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  };
  return [copied, copy];
}

export function PaykitProductIdentity({
  name,
  id,
}: {
  name?: string | null;
  id?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
        <Package className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {name || id || "New product"}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {id || "no-id-yet"}
        </span>
      </span>
    </span>
  );
}
