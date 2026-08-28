"use client";

import { cn } from "@/lib/utils";
import { Plus, X } from "@/lib/icon-theme/lucide-react";

export interface AccountChipItem {
  id: string;
  label: string;
  initial: string;
}

/**
 * Linked-account switcher as a row of pills instead of a full bordered
 * section with its own header — most accounts are 1-2 deep (free plans cap
 * at one), so giving it a whole boxed list was more chrome than content.
 */
export function AccountChips({
  accounts,
  activeId,
  onSwitch,
  onRemove,
  onAdd,
  canAdd,
  addLabel = "Add account",
}: {
  accounts: AccountChipItem[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  canAdd: boolean;
  addLabel?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {accounts.map((account) => {
        const isActive = account.id === activeId;
        return (
          <button
            key={account.id}
            type="button"
            onClick={() => onSwitch(account.id)}
            className={cn(
              "group flex h-8 items-center gap-2 rounded-full border pl-1.5 pr-3 text-xs transition-colors",
              isActive
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-studio-border/60 bg-studio-bg/60 text-muted-foreground hover:border-studio-border hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase",
                isActive ? "bg-primary/20 text-primary" : "bg-muted/70 text-muted-foreground",
              )}
            >
              {account.initial}
            </span>
            <span className="max-w-[16rem] truncate font-medium">{account.label}</span>
            <span
              role="button"
              tabIndex={0}
              title="Remove this account"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(account.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onRemove(account.id);
                }
              }}
              className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? addLabel : "Upgrade to Pro to link more accounts"}
        className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-studio-border/70 px-3 text-xs text-muted-foreground transition-colors hover:border-studio-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  );
}
