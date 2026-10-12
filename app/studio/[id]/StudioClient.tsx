"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

// components
import { StudioInterface } from "@/components/studio/studio-interface";
import { InitialLoadingScreen } from "@/components/studio/initial-loading-screen";

// hooks
import { useStudioBootstrap } from "@/hooks/use-studio-bootstrap";
import { useStudioTitle } from "@/hooks/use-studio-title";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";

export default function StudioClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = params?.id || searchParams?.get("id") || "";
  const numericId = Number(rawId);

  const { loading, error, connection, initialUiState } = useStudioBootstrap(
    Number.isInteger(numericId) && numericId > 0 ? numericId : null,
    searchParams.get("s"),
  );

  useStudioTitle(connection, loading);
  useGlobalAppTheme(false);

  if (loading) return <InitialLoadingScreen />;
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border p-6">
          <h1 className="text-lg font-semibold">Unable to open connection</h1>
          <p role="alert" className="text-sm text-muted-foreground">{error}</p>

          <Link href="/" className="inline-flex rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Back to connections
          </Link>
        </div>
      </main>
    );
  }

  if (!connection) return <main className="min-h-screen p-6">Connection not found.</main>;

  return <StudioInterface connection={connection} initialUiState={initialUiState} />;
}
