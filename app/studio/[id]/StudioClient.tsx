"use client";

import { StudioInterface } from "@/components/studio/studio-interface";
import { InitialLoadingScreen } from "@/components/studio/initial-loading-screen";
import { useStudioBootstrap } from "@/hooks/use-studio-bootstrap";
import { useStudioTitle } from "@/hooks/use-studio-title";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useParams, useSearchParams } from "next/navigation";

export default function StudioClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = params?.id || searchParams?.get("id") || "";
  const numericId = Number(rawId);

  const { loading, connection, initialUiState } = useStudioBootstrap(
    Number.isInteger(numericId) && numericId > 0 ? numericId : null,
    searchParams.get("s"),
  );

  useStudioTitle(connection, loading);
  useGlobalAppTheme(false);

  if (loading) return <InitialLoadingScreen />;
  if (!connection) return <main className="min-h-screen p-6">Connection not found.</main>;

  return <StudioInterface connection={connection} initialUiState={initialUiState} />;
}
