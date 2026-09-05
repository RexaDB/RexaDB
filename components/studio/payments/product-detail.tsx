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
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/lib/supabase-paykit/currencies";
import type {
  PaykitFeatureDraft,
  PaykitPlanDraft,
} from "@/lib/supabase-paykit/types";

interface ProductDetailProps {
  plan: PaykitPlanDraft;
  features: PaykitFeatureDraft[];
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRemovePrice: () => void;
  onAddFeature: (featureId: string) => void;
  onRemoveFeature: (featureId: string) => void;
}

export function ProductDetail({
  plan,
  features,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onRemovePrice,
  onAddFeature,
  onRemoveFeature,
}: ProductDetailProps) {
  const [copied, setCopied] = useState(false);
  const [addId, setAddId] = useState("");

  const paid =
    plan.priceAmount !== null &&
    plan.priceAmount !== undefined &&
    Number.isFinite(Number(plan.priceAmount));
  const sym = currencySymbol(plan.priceCurrency);
  const code = (plan.priceCurrency || "usd").toUpperCase();

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(plan.id);
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
        Products
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
            <Package className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">
                {plan.name || plan.id || "New product"}
              </h2>
              {plan.default ? (
                <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  Default
                </span>
              ) : (
                <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Draft
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {paid ? (
                <>
                  {sym}
                  {Number(plan.priceAmount).toFixed(2)} {code}
                  <span className="mx-1.5">·</span>
                  Per {plan.priceInterval === "year" ? "year" : "month"}
                </>
              ) : (
                "Free"
              )}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold"
            onClick={onEdit}
          >
            Edit product
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Product actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="size-3.5" /> Duplicate
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
            <h3 className="text-base font-semibold">Pricing</h3>
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_36px] gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  <span>Price</span>
                  <span>Billing</span>
                  <span>Features</span>
                  <span>Status</span>
                  <span />
                </div>
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_36px] items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold tabular-nums">
                      {paid ? `${sym}${Number(plan.priceAmount).toFixed(2)} ${code}` : "Free"}
                    </span>
                    {paid && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        Per {plan.priceInterval === "year" ? "year" : "month"}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {paid ? (plan.priceInterval === "year" ? "Yearly" : "Monthly") : "—"}
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
                        aria-label="Price actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={onEdit}>Edit price</DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={!paid}
                        onClick={onRemovePrice}
                      >
                        <Trash2 className="size-3.5" /> Remove price
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Features{" "}
              <span className="font-normal text-muted-foreground">
                ({plan.includes.length})
              </span>
            </h3>
            {plan.includes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                No features yet
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border/70">
                <div className="divide-y divide-border/60">
                  {plan.includes.map((inc) => {
                    const feat = features.find((f) => f.id === inc.featureId);
                    return (
                      <div
                        key={inc.featureId}
                        className="flex items-center gap-2.5 px-3 py-2.5"
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full",
                            feat
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Check className="size-3" />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {inc.featureId}
                        </span>
                        {feat && (
                          <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {feat.type}
                          </span>
                        )}
                        {feat?.type === "metered" && inc.limit != null && (
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {inc.limit}/{inc.reset ?? "month"}
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          title="Remove feature"
                          onClick={() => onRemoveFeature(inc.featureId)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {availableFeaturesCount(features, plan) > 0 ? (
              <div className="flex items-center gap-1.5">
                <Select value={addId} onValueChange={setAddId}>
                  <SelectTrigger className="h-8 flex-1 font-mono text-[11px]">
                    <SelectValue placeholder="Select feature" />
                  </SelectTrigger>
                  <SelectContent>
                    {features
                      .filter((f) => !plan.includes.some((x) => x.featureId === f.id))
                      .map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.id} ({f.type})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  disabled={!addId}
                  onClick={() => {
                    if (addId) {
                      onAddFeature(addId);
                      setAddId("");
                    }
                  }}
                >
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {features.length === 0
                  ? "Create features in the Features tab first."
                  : "All features are already included."}
              </p>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Details</h3>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Product ID</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate">{plan.id}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    title="Copy product ID"
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
              <DetailRow label="Group" value={plan.group} mono />
              <DetailRow
                label="Billing"
                value={paid ? (plan.priceInterval === "year" ? "Yearly" : "Monthly") : "—"}
              />
              <DetailRow label="Currency" value={paid ? code : "—"} mono />
              <DetailRow label="Default" value={plan.default ? "Yes" : "No"} />
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

  function availableFeaturesCount(
    all: PaykitFeatureDraft[],
    p: PaykitPlanDraft,
  ): number {
    return all.filter((f) => !p.includes.some((x) => x.featureId === f.id)).length;
  }
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xs", mono && "font-mono")}>{value}</p>
    </div>
  );
}
