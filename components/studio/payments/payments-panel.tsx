"use client";

import { cn } from "@/lib/utils";
import { getTabIcon } from "@/lib/studio/tab-registry";

/**
 * Payments sidebar section. Mirrors DatabasePanel/AuthPanel: a plain nav
 * list where each item opens a full-width management tab. All editors,
 * tables and setup flows live in the main content area, not in the rail.
 */
export function PaymentsPanel({ studio }: { studio: any }) {
  const items: Array<{ label: string; tabType: string; fn?: () => void }> = [
    { label: "Plans", tabType: "payments-plans", fn: studio.openPaymentsPlansTab },
    { label: "Customers", tabType: "payments-customers", fn: studio.openPaymentsCustomersTab },
    { label: "Subscriptions", tabType: "payments-subscriptions", fn: studio.openPaymentsSubscriptionsTab },
    { label: "Revenue", tabType: "payments-revenue", fn: studio.openPaymentsRevenueTab },
    { label: "Webhooks", tabType: "payments-webhooks", fn: studio.openPaymentsWebhooksTab },
    { label: "Setup", tabType: "payments-setup", fn: studio.openPaymentsSetupTab },
  ];
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {items.map((i) => {
        const Icon = getTabIcon(i.tabType);
        return (
          <button
            key={i.tabType}
            type="button"
            onClick={() => i.fn?.()}
            className={cn(
              "flex h-8 w-full select-none items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0" /> : null}
            <span>{i.label}</span>
          </button>
        );
      })}
    </div>
  );
}
