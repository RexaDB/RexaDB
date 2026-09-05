"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronDown, ChevronsUpDown, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { validatePaykitId } from "@/lib/supabase-paykit/validation";
import { PAYKIT_CURRENCIES, currencySymbol } from "@/lib/supabase-paykit/currencies";
import type {
  PaykitFeatureDraft,
  PaykitPlanDraft,
  PaykitResetInterval,
} from "@/lib/supabase-paykit/types";

interface ProductSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: PaykitFeatureDraft[];
  takenIds: Set<string>;
  onAdd: (plan: PaykitPlanDraft) => void;
  /** When set, the sheet edits an existing product instead of creating one. */
  initialPlan?: PaykitPlanDraft | null;
  title?: string;
  submitLabel?: string;
}

export function slugifyPaykitId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-destructive">
      <CircleAlert className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

export function ProductSheet({
  open,
  onOpenChange,
  features,
  takenIds,
  onAdd,
  initialPlan = null,
  title = "Add a product",
  submitLabel = "Add product",
}: ProductSheetProps) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [group, setGroup] = useState("base");
  const [isDefault, setIsDefault] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [selected, setSelected] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [resets, setResets] = useState<Record<string, PaykitResetInterval>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fresh form every time the sheet opens (prefilled when editing);
  // preview stays hidden by default.
  useEffect(() => {
    if (!open) return;
    setName(initialPlan?.name ?? "");
    setId(initialPlan?.id ?? "");
    setIdTouched(Boolean(initialPlan));
    setAmount(
      initialPlan?.priceAmount == null ? "" : String(initialPlan.priceAmount),
    );
    setCurrency(initialPlan?.priceCurrency ?? "usd");
    setInterval(initialPlan?.priceInterval ?? "month");
    setGroup(initialPlan?.group ?? "base");
    setIsDefault(initialPlan?.default ?? false);
    setMoreOpen(false);
    setPreviewOpen(false);
    setQuantity("1");
    setSelected(initialPlan?.includes.map((x) => x.featureId) ?? []);
    const nextLimits: Record<string, string> = {};
    const nextResets: Record<string, PaykitResetInterval> = {};
    for (const inc of initialPlan?.includes ?? []) {
      if (inc.limit != null) nextLimits[inc.featureId] = String(inc.limit);
      if (inc.reset) nextResets[inc.featureId] = inc.reset;
    }
    setLimits(nextLimits);
    setResets(nextResets);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amountValue = useMemo(() => {
    const raw = amount.trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }, [amount]);

  const qty = useMemo(() => {
    const n = parseInt(quantity, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [quantity]);

  const sym = currencySymbol(currency);

  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toLowerCase();
    if (!q) return PAYKIT_CURRENCIES;
    return PAYKIT_CURRENCIES.filter(
      (c) =>
        c.code.includes(q) ||
        c.name.toLowerCase().includes(q),
    );
  }, [currencySearch]);

  const unitTotal = amountValue === null || Number.isNaN(amountValue) ? 0 : amountValue;
  const lineTotal = unitTotal * qty;

  const toggleFeature = (featureId: string) => {
    setSelected((s) => (s.includes(featureId) ? s.filter((x) => x !== featureId) : [...s, featureId]));
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "Name is required.";
    const idErr = validatePaykitId(id);
    if (idErr) nextErrors.id = idErr;
    else if (takenIds.has(id.trim())) nextErrors.id = "This ID is already used by another product.";
    if (amount.trim() !== "") {
      if (amountValue === null || Number.isNaN(amountValue) || amountValue <= 0 || amountValue > 999999.99) {
        nextErrors.amount = "Enter an amount between 0 and 999,999.99 USD.";
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const includes = selected.map((featureId) => {
      const feat = features.find((f) => f.id === featureId);
      if (feat?.type !== "metered") return { featureId };
      const n = parseInt(limits[featureId] ?? "100", 10);
      return {
        featureId,
        limit: Number.isFinite(n) && n > 0 ? n : 100,
        reset: resets[featureId] ?? ("month" as const),
      };
    });
    onAdd({
      id: id.trim(),
      name: name.trim(),
      group: group.trim() || "base",
      default: isDefault,
      priceAmount: amountValue,
      priceInterval: interval,
      priceCurrency: currency,
      includes,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        contained
        className="flex w-[min(600px,85vw)] flex-col gap-0 p-0"
        resizeHandleLabel="Resize product panel"
        minResizeWidth={420}
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-6 py-4">
          <SheetTitle className="text-xl font-semibold tracking-tight">
            {title}
          </SheetTitle>
          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              {previewOpen ? "Close preview" : "Open preview"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </span>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">
                Name <span className="font-normal text-muted-foreground">(required)</span>
              </span>
              <span className="text-xs text-muted-foreground">
                Name of the product, visible to customers.
              </span>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(slugifyPaykitId(e.target.value));
                }}
                placeholder="Pro"
                className={cn("h-10 rounded-lg text-sm", errors.name && "border-destructive")}
              />
              <FieldError message={errors.name} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">
                Product ID <span className="font-normal text-muted-foreground">(required)</span>
              </span>
              <span className="text-xs text-muted-foreground">
                Unique identifier, auto-filled from the name. Lowercase letters,
                numbers, dashes.
              </span>
              <Input
                value={id}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value.trim());
                }}
                placeholder="pro"
                className={cn("h-10 rounded-lg font-mono text-xs", errors.id && "border-destructive")}
              />
              <FieldError message={errors.id} />
            </label>

            <div>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                More options
                <ChevronDown className={cn("size-3.5 transition-transform", moreOpen && "rotate-180")} />
              </button>
              {moreOpen && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">Group</span>
                    <Input
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      placeholder="base"
                      className="h-10 rounded-lg font-mono text-xs"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border px-3 text-xs font-medium">
                    Default product
                    <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                  </label>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-base font-semibold">Pricing</h3>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">
                Amount <span className="font-normal text-muted-foreground">(required for paid)</span>
              </span>
              <span className="text-xs text-muted-foreground">
                Leave empty for a free product.
              </span>
              <div
                className={cn(
                  "flex h-10 items-center rounded-lg border border-border bg-transparent transition-colors",
                  errors.amount
                    ? "border-destructive"
                    : "focus-within:border-primary/50",
                )}
              >
                <span className="pl-3 text-sm text-muted-foreground">{sym}</span>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="h-full flex-1 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <Popover open={currencyOpen} onOpenChange={(v) => {
                  setCurrencyOpen(v);
                  if (!v) setCurrencySearch("");
                }}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-full shrink-0 cursor-pointer items-center gap-1 border-l border-border px-3 font-mono text-[11px] text-muted-foreground uppercase transition-colors hover:text-foreground"
                    >
                      {currency.toUpperCase()}
                      <ChevronsUpDown className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1" align="end">
                    <Input
                      value={currencySearch}
                      onChange={(e) => setCurrencySearch(e.target.value)}
                      placeholder="Search…"
                      className="h-8 border-0 text-xs shadow-none focus-visible:ring-0"
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {filteredCurrencies.length === 0 ? (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                          No currencies found.
                        </p>
                      ) : (
                        filteredCurrencies.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setCurrency(c.code);
                              setCurrencyOpen(false);
                              setCurrencySearch("");
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                          >
                            <span className="font-mono font-semibold uppercase">
                              {c.code}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {c.name}
                            </span>
                            {c.code === currency && (
                              <Check className="size-3.5 shrink-0" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <FieldError message={errors.amount} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Billing period</span>
              <div className="grid grid-cols-2 gap-2">
                {(["month", "year"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setInterval(v)}
                    className={cn(
                      "h-11 rounded-lg border text-sm font-medium transition-colors",
                      interval === v
                        ? "border-primary/60 bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">
                Features{" "}
                <span className="font-normal text-muted-foreground">
                  ({selected.length} selected)
                </span>
              </span>
              {features.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No features yet — add them in the Features tab first, or add
                  the product now and attach features later.
                </p>
              ) : (
                features.map((f) => {
                  const checked = selected.includes(f.id);
                  const metered = f.type === "metered";
                  return (
                    <div
                      key={f.id}
                      className="rounded-lg border border-border/70 bg-card p-2.5"
                    >
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleFeature(f.id)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {f.id}
                        </span>
                        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {f.type}
                        </span>
                      </label>
                      {checked && metered && (
                        <div className="mt-2 grid grid-cols-2 gap-1.5 pl-7">
                          <Input
                            value={limits[f.id] ?? "100"}
                            onChange={(e) =>
                              setLimits((m) => ({ ...m, [f.id]: e.target.value }))
                            }
                            placeholder="Limit"
                            inputMode="numeric"
                            className="h-8 font-mono text-[11px]"
                          />
                          <Select
                            value={resets[f.id] ?? "month"}
                            onValueChange={(v) =>
                              setResets((m) => ({
                                ...m,
                                [f.id]: v as PaykitResetInterval,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["day", "week", "month", "year"].map((r) => (
                                <SelectItem key={r} value={r}>
                                  per {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {previewOpen && (
            <div className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-muted/20 px-6 py-6 sm:flex">
              <div>
                <h3 className="text-base font-semibold">Preview</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Estimate totals from amount and quantity.
                </p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Unit quantity</span>
                <Input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  inputMode="numeric"
                  className="h-10 rounded-lg font-mono text-xs"
                />
              </label>
              <div className="border-t border-border pt-4 text-sm tabular-nums">
                {qty} × {sym}
                {unitTotal.toFixed(2)} ={" "}
                <span className="font-semibold">
                  {sym}
                  {lineTotal.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm">
                    Total per {interval === "year" ? "year" : "month"}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {sym}
                    {lineTotal.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Billed at the start of the period
                </p>
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
