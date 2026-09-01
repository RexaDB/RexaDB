"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAppUpdate, type AppUpdateReturn } from "@/hooks/use-app-update";

const AppUpdateContext = createContext<AppUpdateReturn | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const value = useAppUpdate();
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdateContext(): AppUpdateReturn {
  const ctx = useContext(AppUpdateContext);
  if (!ctx) {
    throw new Error("useAppUpdateContext must be used within an AppUpdateProvider");
  }
  return ctx;
}
