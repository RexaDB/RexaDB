"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initStudioAuth, loadStudioAuth, clearAllStudioData } from "@/lib/studio-backend/auth-store";
import type { StudioAuth } from "@/lib/studio-backend/auth-store";

interface StudioAuthContextValue {
  auth: StudioAuth | null;
  loading: boolean;
  disconnect: () => Promise<void>;
}

const StudioAuthContext = createContext<StudioAuthContextValue>({
  auth: null,
  loading: true,
  disconnect: async () => {},
});

export function StudioAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StudioAuth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initStudioAuth().then(() => {
      setAuth(loadStudioAuth());
      setLoading(false);
    });
  }, []);

  const disconnect = async () => {
    await clearAllStudioData();
    setAuth(null);
  };

  return (
    <StudioAuthContext.Provider value={{ auth, loading, disconnect }}>
      {children}
    </StudioAuthContext.Provider>
  );
}

export function useStudioAuth() {
  return useContext(StudioAuthContext);
}
