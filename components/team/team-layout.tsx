"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "@/lib/icon-theme/lucide-react";
import { StudioAuthProvider, useStudioAuth } from "./studio-auth-provider";
import { TeamHeader } from "./team-header";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useGlobalAppFontFamily } from "@/hooks/use-global-app-font-family";

function TeamLayoutInner({ children }: { children: React.ReactNode }) {
  useGlobalAppTheme(false);
  useGlobalAppFontFamily();
  const pathname = usePathname();
  const router = useRouter();
  const { auth, loading } = useStudioAuth();

  const isAcceptPage = pathname === "/team/accept-invite" || pathname === "/team/accept-invite/";

  useEffect(() => {
    if (!auth && !loading && !isAcceptPage) {
      router.replace("/team/accept-invite");
    }
  }, [auth, loading, isAcceptPage, router]);

  if (isAcceptPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-studio-bg text-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-studio-bg text-foreground">
      <main className="flex-1 overflow-hidden flex flex-col">
        <TeamHeader />
        {children}
      </main>
    </div>
  );
}

export function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudioAuthProvider>
      <TeamLayoutInner>{children}</TeamLayoutInner>
    </StudioAuthProvider>
  );
}
