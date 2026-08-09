"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getStoredUserProfile } from "@/lib/api/actions-client";
import {
  getStoredLocalModeName,
  getSupabaseUserDisplayName,
  syncAuthenticatedUserProfile,
} from "@/lib/auth/user-profile";
import { supabase } from "@/lib/supabase/client";

const SESSION_RETRY_DELAYS_MS = [0, 500, 1500];

interface AuthState {
  accessToken: string | null;
  authResolved: boolean;
  displayName: string;
  isSessionActive: boolean;
  localDisplayName: string;
  localMode: boolean;
  user: User | null;
  userId: string | null;
}

const INITIAL_AUTH_STATE: AuthState = {
  accessToken: null,
  authResolved: false,
  displayName: "User",
  isSessionActive: false,
  localDisplayName: "User",
  localMode: false,
  user: null,
  userId: null,
};

async function resolveSessionWithRetries() {
  for (const delay of SESSION_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      return data.session;
    }
  }

  return null;
}

async function resolveLocalDisplayName() {
  const storedName = getStoredLocalModeName();
  if (storedName) return storedName;

  const storedProfile = await getStoredUserProfile("local").catch(() => null);
  if (storedProfile?.success && storedProfile.data?.name?.trim()) {
    return storedProfile.data.name.trim();
  }

  return "User";
}

async function buildSessionState(session: Session): Promise<AuthState> {
  let resolvedUser = session.user;

  try {
    const syncedProfile = await syncAuthenticatedUserProfile(session.user);
    resolvedUser = syncedProfile.user;
  } catch {
    resolvedUser = session.user;
  }

  const displayName =
    getSupabaseUserDisplayName(resolvedUser) ||
    session.user.email?.split("@")[0] ||
    "User";

  return {
    accessToken: session.access_token ?? null,
    authResolved: true,
    displayName,
    isSessionActive: true,
    localDisplayName: displayName,
    localMode: false,
    user: resolvedUser,
    userId: session.user.id,
  };
}

async function buildLocalState(): Promise<AuthState> {
  const localDisplayName = await resolveLocalDisplayName();

  return {
    accessToken: null,
    authResolved: true,
    displayName: localDisplayName,
    isSessionActive: false,
    localDisplayName,
    localMode: true,
    user: null,
    userId: "local",
  };
}

export function useAuthState() {
  const [state, setState] = useState<AuthState>(INITIAL_AUTH_STATE);
  const runIdRef = useRef(0);

  const hydrateAuthState = useCallback(async () => {
    try {
      const session = await resolveSessionWithRetries();
      return session ? buildSessionState(session) : buildLocalState();
    } catch {
      return buildLocalState();
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const apply = async (resolver: () => Promise<AuthState>) => {
      const runId = ++runIdRef.current;
      const nextState = await resolver();

      if (!mounted || runId !== runIdRef.current) {
        return;
      }

      setState(nextState);
    };

    void apply(hydrateAuthState);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(() => (session?.user ? buildSessionState(session) : buildLocalState()));
    });

    return () => {
      mounted = false;
      runIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [hydrateAuthState]);

  return state;
}
