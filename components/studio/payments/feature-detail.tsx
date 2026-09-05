"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  ChevronLeft,
  Copy,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { currencySymbol } from "@/lib/supabase-paykit/currencies";
import type {
  PaykitFeatureDraft,
  PaykitPlanDraft,
} from "@/lib/supabase-paykit/types";

interface FeatureDetailProps {
  feature: PaykitFeatureDraft;
  plans: PaykitPlanDraft[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAttach: (planIndex: number) => void;
  onDetach: (planIndex: number) => void;
}

function planPrice(plan: PaykitPlanDraft): string {
  if (
    plan.priceAmount === null ||
    plan.priceAmount === undefined ||
    !Number.isFinite(Number(plan.priceAmount))
  ) {
    return "Free";
  }
  const code = (plan.priceCurrency || "usd").toUpperCase();
  const per = plan.priceInterval === "year" ? "Per year" : "Per month";
  return `${currencySymbol(plan.priceCurrency)}${Number(plan.priceAmount).toFixed(2)} ${code} · ${per}`;
}

export function FeatureDetail({
  feature,
  plans,
  onBack,
  onEdit,
  onDelete,
  onAttach,
  onDetach,
}: FeatureDetailProps) {
  const [copied, setCopied] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachPlan, setAttachPlan] = useState("");

  const displayName = feature.description?.trim() || feature.id;

  const containing = plans
    .map((plan, i) => ({ plan, i }))
    .filter(({ plan }) => plan.includes.some((x) => x.featureId === feature.id));
  const attachable = plans
    .map((plan, i) => ({ plan, i }))
    .filter(({ plan }) => !plan.includes.some((x) => x.featureId === feature.id));

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(feature.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" />
        Features
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">
              {displayName}
            </h2>
            <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              Active
            </span>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            className="h-8 text-xs font-semibold"
            onClick={() => setAttachOpen((v) => !v)}
            disabled={attachable.length === 0}
            title={attachable.length === 0 ? "Attached to every product" : "Attach to product"}
          >
            Attach to product
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Feature actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Products containing this feature</h3>
            {attachOpen && attachable.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Select value={attachPlan} onValueChange={setAttachPlan}>
                  <SelectTrigger className="h-8 flex-1 font-mono text-[11px]">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {attachable.map(({ plan, i }) => (
                      <SelectItem key={`${i}:${plan.id}`} value={String(i)}>
                        {plan.name || plan.id || "New product"} ({plan.id || "no-id"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  disabled={attachPlan === ""}
                  onClick={() => {
                    if (attachPlan !== "") {
                      onAttach(Number(attachPlan));
                      setAttachPlan("");
                      setAttachOpen(false);
                    }
                  }}
                >
                  <Plus className="size-3.5" /> Attach
                </Button>
              </div>
            )}
            {containing.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                No products currently contain this feature.{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setAttachOpen(true)}
                  disabled={attachable.length === 0}
                >
                  Attach to product
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <div className="min-w-[480px]">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_36px] gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    <span>Product</span>
                    <span>Price</span>
                    <span />
                  </div>
                  <div className="divide-y divide-border/60">
                    {containing.map(({ plan, i }) => (
                      <div
                        key={`${i}:${plan.id}`}
                        className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_36px] items-center gap-2 px-3 py-2.5"
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
                        <span className="truncate text-xs tabular-nums text-muted-foreground">
                          {planPrice(plan)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Remove from product"
                          onClick={() => onDetach(i)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Details</h3>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title="Edit feature"
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Lookup key</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate">{feature.id}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    title="Copy lookup key"
                    onClick={copyId}
                  >
                    {copied ? (
                      <Check className="size-3 text-emerald-500" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </Button>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Name</p>
                <p className="mt-0.5 text-xs">{feature.description?.trim() || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Type</p>
                <p className="mt-0.5 text-xs">{feature.type}</p>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Metadata</h3>
            <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
              No metadata
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
