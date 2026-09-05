"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Copy, Package, MoreHorizontal, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductSheet } from "./product-sheet";
import { ProductDetail } from "./product-detail";
import type {
  PaykitDraftState,
  PaykitPlanDraft,
} from "@/lib/supabase-paykit/types";
import { currencySymbol } from "@/lib/supabase-paykit/currencies";

interface PlansTabProps {
  drafts: PaykitDraftState;
  update: (fn: (d: PaykitDraftState) => PaykitDraftState) => void;
}

type PriceFilter = "all" | "paid" | "free";

function isPaid(plan: PaykitPlanDraft): boolean {
  return (
    plan.priceAmount !== null &&
    plan.priceAmount !== undefined &&
    Number.isFinite(Number(plan.priceAmount))
  );
}

/** Stripe-style price: "$29.00 USD" + "Per month", or "Free". */
function formatPrice(plan: PaykitPlanDraft): { main: string; sub: string | null } {
  if (!isPaid(plan)) {
    return { main: "Free", sub: null };
  }
  const code = (plan.priceCurrency || "usd").toUpperCase();
  return {
    main: `${currencySymbol(plan.priceCurrency)}${Number(plan.priceAmount).toFixed(2)} ${code}`,
    sub: plan.priceInterval === "year" ? "Per year" : "Per month",
  };
}

export function PlansTab({ drafts, update }: PlansTabProps) {
  const [filter, setFilter] = useState<PriceFilter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const patchPlan = (index: number, patch: Partial<PaykitPlanDraft>) => {
    update((d) => ({
      ...d,
      plans: d.plans.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  };

  const removePlan = (index: number) => {
    update((d) => ({ ...d, plans: d.plans.filter((_, i) => i !== index) }));
    setSelectedIndex((s) => (s === index ? null : s));
  };

  const duplicatePlan = (index: number) => {
    const src = drafts.plans[index];
    if (!src) return;
    const taken = new Set(drafts.plans.map((p) => p.id));
    let id = src.id ? `${src.id}-copy` : "";
    let n = 2;
    while (id && taken.has(id)) id = `${src.id}-copy-${n++}`;
    const copy: PaykitPlanDraft = {
      ...JSON.parse(JSON.stringify(src)),
      id,
      name: src.name ? `${src.name} copy` : "",
      default: false,
    };
    const newIndex = drafts.plans.length;
    update((d) => ({ ...d, plans: [...d.plans, copy] }));
    setSelectedIndex(newIndex);
  };

  const handleAddProduct = (plan: PaykitPlanDraft) => {
    const newIndex = drafts.plans.length;
    update((d) => ({ ...d, plans: [...d.plans, plan] }));
    setSelectedIndex(newIndex);
  };

  const addFeature = (index: number, featureId: string) => {
    const feat = drafts.features.find((f) => f.id === featureId);
    if (!feat) return;
    patchPlan(index, {
      includes: [
        ...drafts.plans[index].includes,
        feat.type === "metered"
          ? { featureId, limit: 100, reset: "month" as const }
          : { featureId },
      ],
    });
  };

  const removeFeature = (index: number, featureId: string) => {
    patchPlan(index, {
      includes: drafts.plans[index].includes.filter((x) => x.featureId !== featureId),
    });
  };

  // "N" creates a product, like Stripe's Create shortcut (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setSheetOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const takenIds = useMemo(
    () => new Set(drafts.plans.map((p) => p.id)),
    [drafts.plans],
  );
  const editTakenIds = useMemo(
    () =>
      new Set(
        drafts.plans.filter((_, k) => k !== editingIndex).map((p) => p.id),
      ),
    [drafts.plans, editingIndex],
  );

  const selectedPlan =
    selectedIndex !== null ? (drafts.plans[selectedIndex] ?? null) : null;

  if (selectedPlan && selectedIndex !== null) {
    const index = selectedIndex;
    return (
      <>
        <ProductDetail
          plan={selectedPlan}
          features={drafts.features}
          onBack={() => setSelectedIndex(null)}
          onEdit={() => setEditingIndex(index)}
          onDuplicate={() => duplicatePlan(index)}
          onDelete={() => removePlan(index)}
          onRemovePrice={() => patchPlan(index, { priceAmount: null })}
          onAddFeature={(fid) => addFeature(index, fid)}
          onRemoveFeature={(fid) => removeFeature(index, fid)}
        />
        <ProductSheet
          open={editingIndex !== null}
          onOpenChange={(v) => {
            if (!v) setEditingIndex(null);
          }}
          features={drafts.features}
          takenIds={editTakenIds}
          initialPlan={editingIndex !== null ? (drafts.plans[editingIndex] ?? null) : null}
          title="Edit product"
          submitLabel="Save changes"
          onAdd={(plan) => {
            if (editingIndex !== null) patchPlan(editingIndex, plan);
            setEditingIndex(null);
          }}
        />
      </>
    );
  }

  const visiblePlans = drafts.plans
    .map((plan, i) => ({ plan, i }))
    .filter(({ plan }) =>
      filter === "all" ? true : filter === "paid" ? isPaid(plan) : !isPaid(plan),
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {(["all", "paid", "free"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "h-8 rounded-lg border px-3 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "border-foreground/60 font-semibold"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "paid" ? "Paid" : f === "free" ? "Free" : "All"}
            </button>
          ))}
        </div>
        <Button className="h-8 gap-1.5 text-xs font-semibold" onClick={() => setSheetOpen(true)}>
          <Plus className="size-4" /> Create product <Kbd>N</Kbd>
        </Button>
      </div>

      {drafts.plans.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-3 py-8 text-center">
          <p className="text-sm font-medium">No products yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Create your first product above, or load a starter template from
            Features.
          </p>
        </div>
      ) : visiblePlans.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
          No {filter === "paid" ? "paid" : "free"} products.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_36px] gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
              <span>Product</span>
              <span>Pricing</span>
              <span>Features</span>
              <span>Status</span>
              <span />
            </div>
            <div className="divide-y divide-border/60">
              {visiblePlans.map(({ plan, i }) => {
                const price = formatPrice(plan);
                return (
                  <div
                    key={`${i}:${plan.id || "new"}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedIndex(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedIndex(i);
                      }
                    }}
                    className="grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_36px] items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
                        <Package className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {plan.name || plan.id || "New product"}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {plan.id || "no-id-yet"}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm tabular-nums">
                        {price.main}
                      </span>
                      {price.sub && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {price.sub}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {plan.includes.length === 0
                        ? "—"
                        : `${plan.includes.length} feature${plan.includes.length === 1 ? "" : "s"}`}
                    </span>
                    <span>
                      {plan.default ? (
                        <span className="inline-flex h-[22px] items-center rounded-full border border-primary/20 bg-primary/10 px-2 text-[11px] font-medium text-primary">
                          Default
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          aria-label="Product actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelectedIndex(i)}>
                          <Pencil className="size-3.5" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicatePlan(i)}>
                          <Copy className="size-3.5" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => removePlan(i)}
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <ProductSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        features={drafts.features}
        takenIds={takenIds}
        onAdd={handleAddProduct}
      />
    </div>
  );
}
