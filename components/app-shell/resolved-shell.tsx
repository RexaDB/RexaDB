"use client";

/**
 * Resolves the active app shell: extension React override (`registerUiComponent("shell", …)`)
 * or the built-in ModernUIShell. Studio / connections pages should render this
 * so a different shell can take over without editing every call site.
 */

import { ModernUIShell, type ModernUIShellProps } from "@/components/app-shell/modern-ui-shell";
import { useUiComponent } from "@/lib/extensions/ui-registry";

export type AppShellProps = ModernUIShellProps;

export function AppShell(props: AppShellProps) {
  const Shell = useUiComponent("shell", ModernUIShell);
  return <Shell {...props} />;
}

/** @deprecated Prefer `AppShell` — kept so existing imports keep working. */
export { AppShell as ResolvedModernUIShell };
