"use client";

import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";

export default function AuthPageRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-studio-bg text-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />

            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        </div>
      }
    >
      <AuthPage />
    </Suspense>
  );
}
