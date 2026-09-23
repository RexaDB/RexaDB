"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "@/lib/icon-theme/lucide-react";
import type { AccountChipItem } from "@/components/shared/provider-accounts/account-chips";

export function buildAccountChips<T extends { id: string }>(
  accounts: T[],
  labelFor: (account: T) => string,
): AccountChipItem[] {
  return accounts.map((account) => {
    const label = labelFor(account);
    return { id: account.id, label, initial: label.slice(0, 1) };
  });
}

export function ProviderLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  );
}

export function ProviderBranchLoadingState() {
  return (
    <div className="flex items-center justify-center py-5">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    </div>
  );
}

export function ProviderLoadError({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction && (
        <Button
          size="sm"
          className="mt-3 h-7 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function ProviderOrgError({ message }: { message: string }) {
  return (
    <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
      <p className="text-xs text-destructive">{message}</p>
    </div>
  );
}

export function filterByName<T>(
  items: T[],
  search: string,
  pick: (item: T) => string[],
): T[] {
  const q = search.toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    pick(item).some((v) => v.toLowerCase().includes(q)),
  );
}
