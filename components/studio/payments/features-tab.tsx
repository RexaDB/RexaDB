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
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeatureSheet } from "./feature-sheet";
import { FeatureDetail } from "./feature-detail";
import type {
  PaykitDraftState,
  PaykitFeatureType,
} from "@/lib/supabase-paykit/types";

interface FeaturesTabProps {
  drafts: PaykitDraftState;
  update: (fn: (d: PaykitDraftState) => PaykitDraftState) => void;
}

type TypeFilter = "all" | "boolean" | "metered";

export function FeaturesTab({ drafts, update }: FeaturesTabProps) {
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const takenIds = useMemo(
    () => new Set(drafts.features.map((f) => f.id)),
    [drafts.features],
  );
  const editTakenIds = useMemo(
    () =>
      new Set(
        drafts.features.filter((_, k) => k !== editingIndex).map((f) => f.id),
      ),
    [drafts.features, editingIndex],
  );
  const usedIn = (featureId: string) =>
    drafts.plans.filter((p) => p.includes.some((x) => x.featureId === featureId))
      .length;

  const patchFeature = (index: number, patch: Partial<{ id: string; type: PaykitFeatureType; description: string }>) => {
    update((d) => ({
      ...d,
      features: d.features.map((x, k) => (k === index ? { ...x, ...patch } : x)),
    }));
  };

  const removeFeature = (index: number) => {
    update((d) => ({
      ...d,
      features: d.features.filter((_, k) => k !== index),
    }));
    setSelectedIndex((s) => (s === index ? null : s));
  };

  const attachToPlan = (featureId: string, planIndex: number) => {
    const feat = drafts.features.find((f) => f.id === featureId);
    if (!feat) return;
    update((d) => ({
      ...d,
      plans: d.plans.map((p, k) =>
        k === planIndex
          ? {
              ...p,
              includes: [
                ...p.includes,
                feat.type === "metered"
                  ? { featureId, limit: 100, reset: "month" as const }
                  : { featureId },
              ],
            }
          : p,
      ),
    }));
  };

  const detachFromPlan = (featureId: string, planIndex: number) => {
    update((d) => ({
      ...d,
      plans: d.plans.map((p, k) =>
        k === planIndex
          ? { ...p, includes: p.includes.filter((x) => x.featureId !== featureId) }
          : p,
      ),
    }));
  };

  // "F" creates a feature, like "N" creates a product (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey) return;
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

  const selectedFeature =
    selectedIndex !== null ? (drafts.features[selectedIndex] ?? null) : null;

  if (selectedFeature && selectedIndex !== null) {
    const index = selectedIndex;
    const feature = selectedFeature;
    return (
      <>
        <FeatureDetail
          feature={feature}
          plans={drafts.plans}
          onBack={() => setSelectedIndex(null)}
          onEdit={() => setEditingIndex(index)}
          onDelete={() => removeFeature(index)}
          onAttach={(planIndex) => attachToPlan(feature.id, planIndex)}
          onDetach={(planIndex) => detachFromPlan(feature.id, planIndex)}
        />
        <FeatureSheet
          open={editingIndex !== null}
          onOpenChange={(v) => {
            if (!v) setEditingIndex(null);
          }}
          takenIds={editTakenIds}
          initialFeature={editingIndex !== null ? (drafts.features[editingIndex] ?? null) : null}
          title="Edit feature"
          submitLabel="Save changes"
          onAdd={(f) => {
            if (editingIndex !== null) patchFeature(editingIndex, f);
            setEditingIndex(null);
          }}
        />
      </>
    );
  }

  const visibleFeatures = drafts.features
    .map((feature, i) => ({ feature, i }))
    .filter(({ feature }) =>
      filter === "all" ? true : feature.type === filter,
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {(["all", "boolean", "metered"] as const).map((f) => (
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
              {f === "all" ? "All" : f === "boolean" ? "Boolean" : "Metered"}
            </button>
          ))}
        </div>
        <Button className="h-8 gap-1.5 text-xs font-semibold" onClick={() => setSheetOpen(true)}>
          <Plus className="size-4" /> Create feature <Kbd>F</Kbd>
        </Button>
      </div>

      {drafts.features.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-3 py-8 text-center">
          <p className="text-sm font-medium">No features yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Boolean features gate access; metered features track
            usage against a limit.
          </p>
        </div>
      ) : visibleFeatures.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
          No {filter} features.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_36px] gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
              <span>Feature</span>
              <span>Type</span>
              <span>Used in</span>
              <span>Status</span>
              <span />
            </div>
            <div className="divide-y divide-border/60">
              {visibleFeatures.map(({ feature: f, i }) => {
                const count = usedIn(f.id);
                return (
                  <div
                    key={`${i}:${f.id || "new"}`}
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
                        <KeyRound className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {f.description?.trim() || f.id || "New feature"}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {f.id || "no-id-yet"}
                        </span>
                      </span>
                    </span>
                    <span className="truncate text-xs capitalize text-muted-foreground">
                      {f.type}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {count === 0 ? "—" : `${count} plan${count === 1 ? "" : "s"}`}
                    </span>
                    <span>
                      <span className="inline-flex h-[22px] items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        Active
                      </span>
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          aria-label="Feature actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelectedIndex(i)}>
                          <Pencil className="size-3.5" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingIndex(i)}>
                          <Pencil className="size-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => removeFeature(i)}
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
      <FeatureSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        takenIds={takenIds}
        onAdd={(feature) =>
          update((d) => ({ ...d, features: [...d.features, feature] }))
        }
      />
      <FeatureSheet
        open={editingIndex !== null}
        onOpenChange={(v) => {
          if (!v) setEditingIndex(null);
        }}
        takenIds={editTakenIds}
        initialFeature={editingIndex !== null ? (drafts.features[editingIndex] ?? null) : null}
        title="Edit feature"
        submitLabel="Save changes"
        onAdd={(f) => {
          if (editingIndex !== null) patchFeature(editingIndex, f);
          setEditingIndex(null);
        }}
      />
    </div>
  );
}
